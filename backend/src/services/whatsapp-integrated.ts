/**
 * Integrated WhatsApp Service using Baileys
 * Pure WebSocket connection - NO Chrome/Puppeteer needed
 * Works on stateless hosting like Render
 * Sessions stored in Firestore for persistence
 */

import makeWASocket, {
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  BufferJSON,
  initAuthCreds,
  AuthenticationCreds,
  SignalDataTypeMap
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import pino from 'pino';
import { db, COLLECTIONS } from '../config/firebase';
import { updateWhatsAppState, getWhatsAppState } from '../routes/whatsapp';
import { hybridMessageStore } from './hybrid-message-store';
import { hybridActionItems } from './hybrid-action-items';
import { classifyWithAI, initGemini } from './ai-classifier';
import log from './activity-log';

// ============================================
// FIRESTORE AUTH STATE STORAGE
// ============================================

/**
 * Custom auth state that stores credentials in Firestore instead of files
 * This enables stateless hosting on Render/Railway/Fly.io
 */
async function useFirestoreAuthState(sessionId: string = 'default') {
  const collectionName = COLLECTIONS.WHATSAPP_SESSIONS;

  // Helper to create document ID
  const getDocId = (key: string) => `${sessionId}_${key}`.replace(/[\/\\]/g, '_');

  // Helper to read from Firestore
  const readData = async (key: string): Promise<any> => {
    try {
      const docRef = db.collection(collectionName).doc(getDocId(key));
      const doc = await docRef.get();
      
      if (!doc.exists) return null;
      
      const data = doc.data();
      return data?.value ? JSON.parse(data.value, BufferJSON.reviver) : null;
    } catch (error) {
      console.error(`Error reading ${key} from Firestore:`, error);
      return null;
    }
  };

  // Helper to write to Firestore
  const writeData = async (key: string, value: any): Promise<void> => {
    try {
      const docRef = db.collection(collectionName).doc(getDocId(key));
      const serialized = JSON.stringify(value, BufferJSON.replacer);
      
      await docRef.set({
        sessionId,
        key,
        value: serialized,
        updatedAt: new Date()
      }, { merge: true });
    } catch (error) {
      console.error(`Error writing ${key} to Firestore:`, error);
    }
  };

  // Helper to delete from Firestore
  const removeData = async (key: string): Promise<void> => {
    try {
      const docRef = db.collection(collectionName).doc(getDocId(key));
      await docRef.delete();
    } catch (error) {
      console.error(`Error deleting ${key} from Firestore:`, error);
    }
  };

  // Load existing creds or initialize new ones
  const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          
          await Promise.all(
            ids.map(async (id) => {
              const value = await readData(`${type}-${id}`);
              if (value) {
                data[id] = value;
              }
            })
          );
          
          return data;
        },
        set: async (data: any): Promise<void> => {
          const tasks: Promise<void>[] = [];
          
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              
              if (value) {
                tasks.push(writeData(key, value));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData('creds', creds);
    },
    clearSession: async () => {
      // Delete all session documents
      try {
        const snapshot = await db.collection(collectionName)
          .where('sessionId', '==', sessionId)
          .get();
        
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        console.log(`Cleared ${snapshot.size} session documents`);
      } catch (error) {
        console.error('Error clearing session:', error);
      }
    }
  };
}

// ============================================
// WHATSAPP SERVICE
// ============================================

let whatsappSocket: WASocket | null = null;
let isStarting = false;
let messagesProcessed = 0;
let authState: Awaited<ReturnType<typeof useFirestoreAuthState>> | null = null;

// Store message with AI classification and create action items
async function storeMessage(msg: proto.IWebMessageInfo): Promise<string | null> {
  try {
    const content = msg.message?.conversation || 
                    msg.message?.extendedTextMessage?.text || 
                    msg.message?.imageMessage?.caption ||
                    msg.message?.videoMessage?.caption ||
                    '[Media/No Content]';
    
    const sender = msg.pushName || msg.key.remoteJid || 'Unknown';
    const chatName = msg.key.remoteJid || 'Unknown';
    const isGroup = chatName.endsWith('@g.us');
    
    // Classify with AI
    log.info('Classifying message', `From: ${sender}`);
    const classification = await classifyWithAI(content, sender);

    const messageData = {
      sender: sender,
      chat_name: chatName,
      timestamp: new Date((msg.messageTimestamp as number) * 1000).toISOString(),
      content: content,
      message_type: Object.keys(msg.message || {})[0] || 'text',
      classification: classification.category,
      decision: classification.decision,
      priority: classification.priority,
      ai_reasoning: classification.reasoning,
      metadata: {
        isGroupMsg: isGroup,
        fromMe: msg.key.fromMe,
        suggestedTask: classification.suggestedTask,
        deadline: classification.deadline,
        actionItemsCount: classification.actionItems?.length || 0
      }
    };

    // Store using hybrid store (Firestore or in-memory)
    const stored = await hybridMessageStore.add(messageData);
    const messageId = stored.id;
    
    log.success(`Message stored (${hybridMessageStore.getStorageType()})`, 
      `${classification.category.toUpperCase()} | ${classification.priority} | ${classification.decision}`,
      { id: stored.id, sender, classification }
    );

    // Create action items from AI extraction
    if (classification.actionItems && classification.actionItems.length > 0) {
      for (const aiAction of classification.actionItems) {
        const actionItem = await hybridActionItems.add({
          messageId,
          title: aiAction.title,
          description: aiAction.description || content,
          sender,
          chatName,
          priority: aiAction.priority || 'medium',
          category: classification.category === 'work' || classification.category === 'study' || classification.category === 'personal' || classification.category === 'urgent' 
            ? classification.category 
            : 'other',
          dueDate: aiAction.dueDate || null,
          dueTime: aiAction.dueTime || null,
          tags: [aiAction.type],
          originalMessage: content,
          aiConfidence: 0.9,
          status: 'pending',
          completedAt: null
        });
        log.info('AI Action Item Created', actionItem.title);
      }
    } else if (classification.decision === 'create' || classification.decision === 'review') {
      const actionItem = await hybridActionItems.add({
        messageId,
        title: classification.suggestedTask || content.slice(0, 80),
        description: content.length > 80 ? content : null,
        sender,
        chatName,
        priority: classification.priority as 'urgent' | 'high' | 'medium' | 'low' || 'medium',
        category: classification.category === 'work' || classification.category === 'study' || classification.category === 'personal' || classification.category === 'urgent' 
          ? classification.category 
          : 'other',
        dueDate: classification.deadline || null,
        dueTime: null,
        tags: [],
        originalMessage: content,
        aiConfidence: 0.7,
        status: 'pending',
        completedAt: null
      });
      
      if (actionItem) {
        log.info('Action Item Auto-Created', actionItem.title);
      }
    }

    return messageId;
  } catch (error: any) {
    log.error('Store message failed', error.message);
    return null;
  }
}

// Start WhatsApp client using Baileys
export async function startWhatsApp(): Promise<void> {
  if (isStarting) {
    log.warning('WhatsApp already starting');
    return;
  }

  const currentState = getWhatsAppState();
  if (currentState.status === 'connected') {
    log.info('WhatsApp already connected');
    return;
  }

  isStarting = true;
  updateWhatsAppState({ 
    status: 'initializing', 
    error: null,
    progress: 0,
    progressText: 'Initializing WhatsApp...',
    connectionStartTime: Date.now()
  });

  // Initialize Gemini AI
  initGemini();

  log.info('Starting WhatsApp Client', 'Using Baileys (WebSocket)...');

  try {
    // Get Firestore auth state
    authState = await useFirestoreAuthState('wa-task-manager');
    
    // Fetch latest Baileys version
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    updateWhatsAppState({
      status: 'initializing',
      progressText: 'Connecting to WhatsApp...'
    });

    // Create socket connection - NO CHROME/PUPPETEER!
    whatsappSocket = makeWASocket({
      version,
      auth: {
        creds: authState.state.creds,
        keys: makeCacheableSignalKeyStore(authState.state.keys, pino({ level: 'silent' }) as any)
      },
      printQRInTerminal: false, // We handle QR ourselves
      browser: ['WhatsApp Task Manager', 'Chrome', '120.0.0'],
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      logger: pino({ level: 'silent' }) as any
    });

    // Handle connection updates
    whatsappSocket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR Code received - generate base64 image
      if (qr) {
        console.log('📱 QR Code received from Baileys');
        try {
          // Generate QR code as base64 data URL
          const qrImage = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          
          updateWhatsAppState({
            status: 'qr_ready',
            qrCode: qrImage,
            progress: 0,
            progressText: 'Scan QR code with WhatsApp'
          });
          
          log.info('QR Code Ready', 'Scan with WhatsApp mobile app');
        } catch (err) {
          console.error('QR generation error:', err);
        }
      }

      // Connection state changes
      if (connection === 'connecting') {
        updateWhatsAppState({
          status: 'connecting',
          progressText: 'Connecting to WhatsApp servers...'
        });
      }

      // Connection established
      if (connection === 'open') {
        const user = whatsappSocket?.user;
        const userName = user?.name || 'Unknown';
        const userPhone = user?.id?.split(':')[0] || user?.id || 'Unknown';
        
        console.log(`✅ WhatsApp connected as: ${userName} (${userPhone})`);
        
        updateWhatsAppState({
          status: 'connected',
          qrCode: null,
          user: {
            name: userName,
            phone: userPhone
          },
          progress: 100,
          progressText: 'Connected!',
          messagesProcessed: 0
        });
        
        log.success('WhatsApp Connected', `${userName} (${userPhone})`);
        isStarting = false;
      }

      // Connection closed
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log(`📱 Connection closed. Status: ${statusCode}, Reconnecting: ${shouldReconnect}`);
        
        if (statusCode === DisconnectReason.loggedOut) {
          // User logged out - clear session
          log.warning('WhatsApp Logged Out', 'Session cleared');
          if (authState) {
            await authState.clearSession();
          }
          updateWhatsAppState({
            status: 'disconnected',
            user: null,
            qrCode: null,
            error: 'Logged out from WhatsApp'
          });
        } else if (shouldReconnect) {
          // Auto-reconnect
          log.info('Reconnecting', 'Connection lost, attempting reconnect...');
          updateWhatsAppState({
            status: 'connecting',
            progressText: 'Reconnecting...'
          });
          
          isStarting = false;
          setTimeout(() => startWhatsApp(), 3000);
        } else {
          updateWhatsAppState({
            status: 'disconnected',
            user: null,
            qrCode: null
          });
        }
        
        isStarting = false;
      }
    });

    // Save credentials when updated
    whatsappSocket.ev.on('creds.update', async () => {
      if (authState) {
        await authState.saveCreds();
      }
    });

    // Listen for incoming messages
    whatsappSocket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Skip own messages
        if (msg.key.fromMe) continue;
        
        // Skip status updates
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const content = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || 
                        '[Media]';
        const sender = msg.pushName || msg.key.remoteJid || 'Unknown';

        messagesProcessed++;
        updateWhatsAppState({ messagesProcessed });

        // Log the incoming message
        log.message(sender, content.substring(0, 100));

        // Store and classify with AI
        await storeMessage(msg);
      }
    });

    log.info('WhatsApp Service Started', 'Waiting for connection...');

  } catch (error: any) {
    console.error('❌ WhatsApp error:', error);
    log.error('WhatsApp Error', error.message);
    updateWhatsAppState({
      status: 'error',
      error: error.message
    });
    isStarting = false;
  }
}

// Stop WhatsApp
export async function stopWhatsApp(): Promise<void> {
  if (whatsappSocket) {
    try {
      whatsappSocket.end(undefined);
    } catch (e) {
      // Ignore
    }
    whatsappSocket = null;
  }
  
  updateWhatsAppState({
    status: 'disconnected',
    qrCode: null,
    user: null
  });
  
  log.info('WhatsApp Disconnected');
}

// Logout and clear session
export async function logoutWhatsApp(): Promise<void> {
  if (whatsappSocket) {
    try {
      await whatsappSocket.logout();
    } catch (e) {
      // Ignore
    }
    whatsappSocket = null;
  }
  
  // Clear Firestore session
  if (authState) {
    await authState.clearSession();
  }
  
  updateWhatsAppState({
    status: 'disconnected',
    qrCode: null,
    user: null
  });
  
  log.info('WhatsApp Logged Out', 'Session cleared');
}

// Check if connected
export function isWhatsAppConnected(): boolean {
  return getWhatsAppState().status === 'connected';
}

// Get socket (for sending messages etc)
export function getWhatsAppSocket(): WASocket | null {
  return whatsappSocket;
}
