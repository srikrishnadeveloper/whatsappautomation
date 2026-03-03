/**
 * Gemini AI Classifier — Production Grade
 * Uses enhanced rule-based pre-filtering + Google Gemini for uncertain cases.
 * Goal: 60-70% of messages handled by rules alone, minimising AI API calls.
 * Also supports Gemini Vision for WhatsApp image messages.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import log from './activity-log';
import clog from './console-logger';
import { classifyMessage as ruleBasedClassify, makeDecision } from '../classifier/rule-based';
import { initMLClassifier, classifyWithML, isMLClassifierReady, getMLClassifierStatus } from '../classifier/ml';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

let genAI: GoogleGenerativeAI | null = null;
let model: any = null;
let visionModel: any = null; // Dedicated vision model instance

// Stats tracking
let aiCallCount = 0;
let ruleOnlyCount = 0;
let mlCallCount = 0;
let visionCallCount = 0;

// Initialize Gemini
export function initGemini() {
  if (!GEMINI_API_KEY) {
    log.warning('Gemini API key not found', 'Using rule-based classification only');
    return false;
  }

  try {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    // gemini-2.5-flash for vision — better image understanding + OCR accuracy
    visionModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    log.success('Gemini AI initialized', 'text=gemini-2.0-flash | vision=gemini-2.5-flash');
    return true;
  } catch (error: any) {
    log.error('Failed to initialize Gemini', error.message);
    return false;
  }
}

// Action item extracted by AI
export interface ExtractedActionItem {
  title: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  type: 'meeting' | 'deadline' | 'reminder' | 'task' | 'followup' | 'call' | 'other';
  assignee?: string;
}

// Classification result
export interface ClassificationResult {
  category: 'work' | 'study' | 'personal' | 'urgent' | 'casual' | 'spam';
  priority: 'high' | 'medium' | 'low' | 'none';
  decision: 'create' | 'review' | 'ignore';
  reasoning: string;
  suggestedTask?: string;
  deadline?: string;
  actionItems?: ExtractedActionItem[];
}

// Image analysis result from Gemini Vision
export interface ImageAnalysisResult {
  description: string;           // What is in the image
  extractedText: string;         // Any text/writing visible in the image
  combinedContent: string;       // Combined description + caption for classification
  hasActionableContent: boolean; // True if image contains tasks/deadlines/meetings
  suggestedCategory: string;     // Suggested message category
  mimeType: string;
}

// ============================================
// GEMINI VISION — Image Analysis
// ============================================

/**
 * Download and analyze an image via Gemini Vision.
 * Returns a full ImageAnalysisResult with description, OCR text, and combined content
 * ready to be fed straight into classifyWithAI.
 */
export async function analyzeImageWithGemini(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg',
  caption: string = ''
): Promise<ImageAnalysisResult> {
  const fallback: ImageAnalysisResult = {
    description: caption || '[Image]',
    extractedText: '',
    combinedContent: caption || '[Image - no analysis available]',
    hasActionableContent: false,
    suggestedCategory: 'casual',
    mimeType,
  };

  if (!visionModel) {
    clog.logFallback('Vision model not initialized — returning caption only');
    return fallback;
  }

  try {
    const base64 = imageBuffer.toString('base64');

    const imagePart = {
      inlineData: {
        data: base64,
        mimeType,
      },
    } as any;

    const prompt = `Analyze this WhatsApp image precisely and return ONLY JSON (no markdown):
{
  "description": "concise 1-2 sentence description of what you see",
  "extractedText": "ALL visible text, numbers, dates, names exactly as written — empty string if none",
  "hasActionableContent": true/false,
  "suggestedCategory": "work|study|personal|urgent|casual|spam"
}

Rules:
- extractedText must capture every word, number, deadline, meeting time visible
- hasActionableContent = true if image shows tasks, deadlines, meeting invites, invoices, documents, schedules
- Be precise about dates, times, names visible in the image
${caption ? `\nCaption from sender: "${caption}"` : ''}`;

    const result = await visionModel.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    visionCallCount++;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warning('Gemini Vision response unparseable', text.slice(0, 200));
      return {
        ...fallback,
        description: text.slice(0, 300),
        combinedContent: caption ? `${caption}\n[Image: ${text.slice(0, 200)}]` : `[Image: ${text.slice(0, 200)}]`,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const description: string  = parsed.description   || '';
    const extractedText: string = parsed.extractedText || '';
    const hasActionable: boolean = !!parsed.hasActionableContent;
    const suggestedCat: string  = parsed.suggestedCategory || 'casual';

    // Build the combined content that will be fed into the text classifier
    const parts: string[] = [];
    if (caption)       parts.push(`Caption: ${caption}`);
    if (description)   parts.push(`Image: ${description}`);
    if (extractedText) parts.push(`Text in image: ${extractedText}`);
    const combinedContent = parts.join('\n') || '[Image - no content extracted]';

    log.success('Gemini Vision analyzed image', 
      `${description.slice(0, 80)} | textLen=${extractedText.length} | actionable=${hasActionable} [vision #${visionCallCount}]`);
    clog.logGeminiResult(suggestedCat, hasActionable ? 'high' : 'low', hasActionable ? 'create' : 'review', 0, visionCallCount);

    return {
      description,
      extractedText,
      combinedContent,
      hasActionableContent: hasActionable,
      suggestedCategory: suggestedCat,
      mimeType,
    };
  } catch (error: any) {
    clog.logPipelineError('Gemini Vision', error.message);
    log.warning('Gemini Vision failed', error.message);
    return fallback;
  }
}

// ============================================
// GEMINI DOCUMENT ANALYSIS — PDF / text docs
// ============================================

/** Result from analyzing a document with Gemini */
export interface DocumentAnalysisResult {
  summary: string;            // Short summary of the document
  extractedText: string;      // Key text/data from the document
  combinedContent: string;    // Combined text for classification
  hasActionableContent: boolean;
  suggestedCategory: string;
  documentType: string;       // e.g. "invoice", "assignment", "report", "notes"
  keyEntities: string[];      // Names, dates, amounts, etc.
}

/**
 * Analyze a document buffer via Gemini.
 * Only works for text-based documents (PDF, DOCX-ish, TXT, CSV, etc.)
 * Large images inside PDFs are skipped — this is text extraction.
 */
export async function analyzeDocumentWithGemini(
  docBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<DocumentAnalysisResult> {
  const fallback: DocumentAnalysisResult = {
    summary: `Document: ${fileName}`,
    extractedText: '',
    combinedContent: `[Document: ${fileName}]`,
    hasActionableContent: false,
    suggestedCategory: 'casual',
    documentType: 'unknown',
    keyEntities: [],
  };

  // Only attempt analysis for supported MIME types
  const supportedTypes = [
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/json',
    'text/html',
    'text/markdown',
  ];

  if (!visionModel) {
    clog.logFallback('Vision model not initialized — skipping document analysis');
    return fallback;
  }

  // Skip very large documents (>5 MB text analysis is unreliable)
  if (docBuffer.length > 5 * 1024 * 1024) {
    log.info('📄 Document too large for AI analysis', `${(docBuffer.length / 1024 / 1024).toFixed(1)} MB — skipping`);
    return fallback;
  }

  const isSupported = supportedTypes.some(t => mimeType.startsWith(t.split('/')[0]) || mimeType === t);
  // For PDFs, send as inline data (Gemini supports PDF natively)
  // For text files, send raw text content
  const isPDF = mimeType === 'application/pdf';

  try {
    let prompt: string;
    let parts: any[];

    if (isPDF) {
      // Gemini 2.0 flash supports PDF as inline data
      const base64 = docBuffer.toString('base64');
      parts = [
        {
          inlineData: {
            data: base64,
            mimeType: 'application/pdf',
          },
        } as any,
      ];
      prompt = `Analyze this PDF document and return ONLY JSON (no markdown):
{
  "summary": "2-3 sentence summary of the document",
  "extractedText": "ALL key text: names, dates, deadlines, amounts, action items — exact as written. Max 1000 chars.",
  "hasActionableContent": true/false,
  "suggestedCategory": "work|study|personal|urgent|casual|spam",
  "documentType": "invoice|assignment|report|notes|letter|form|schedule|presentation|spreadsheet|other",
  "keyEntities": ["entity1", "entity2"]
}
Rules:
- extractedText must capture every deadline, name, amount, date, task
- keyEntities = important names, dates, amounts, headings
- hasActionableContent = true if document contains tasks, deadlines, things to do
- Be thorough — this text will be used for search later`;
    } else if (isSupported || mimeType.startsWith('text/')) {
      // For text files, convert buffer to string
      const textContent = docBuffer.toString('utf-8').slice(0, 8000); // Truncate for token safety
      parts = [];
      prompt = `Analyze this document content and return ONLY JSON (no markdown):

DOCUMENT NAME: ${fileName}
DOCUMENT CONTENT:
${textContent}

{
  "summary": "2-3 sentence summary of the document",
  "extractedText": "ALL key text: names, dates, deadlines, amounts, action items — exact as written. Max 1000 chars.",
  "hasActionableContent": true/false,
  "suggestedCategory": "work|study|personal|urgent|casual|spam",
  "documentType": "invoice|assignment|report|notes|letter|form|schedule|presentation|spreadsheet|other",
  "keyEntities": ["entity1", "entity2"]
}
Rules:
- extractedText must capture every deadline, name, amount, date, task
- keyEntities = important names, dates, amounts, headings
- hasActionableContent = true if document contains tasks, deadlines, things to do`;
    } else {
      // Unsupported type — return just filename-based fallback
      return fallback;
    }

    const result = await visionModel.generateContent(parts.length > 0 ? [prompt, ...parts] : [prompt]);
    const response = await result.response;
    const text = response.text();

    visionCallCount++;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warning('Gemini Document analysis unparseable', text.slice(0, 200));
      return { ...fallback, summary: text.slice(0, 300), combinedContent: `[Document: ${fileName}] ${text.slice(0, 200)}` };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const summary: string       = parsed.summary || '';
    const extractedText: string = parsed.extractedText || '';
    const hasActionable: boolean = !!parsed.hasActionableContent;
    const suggestedCat: string  = parsed.suggestedCategory || 'casual';
    const documentType: string  = parsed.documentType || 'other';
    const keyEntities: string[] = parsed.keyEntities || [];

    const combinedParts: string[] = [];
    combinedParts.push(`Document: ${fileName}`);
    if (summary) combinedParts.push(`Summary: ${summary}`);
    if (extractedText) combinedParts.push(`Content: ${extractedText}`);
    const combinedContent = combinedParts.join('\n');

    log.success('📄 Document analyzed',
      `${fileName} | type=${documentType} | actionable=${hasActionable} | entities=${keyEntities.length} [vision #${visionCallCount}]`);

    return {
      summary,
      extractedText,
      combinedContent,
      hasActionableContent: hasActionable,
      suggestedCategory: suggestedCat,
      documentType,
      keyEntities,
    };
  } catch (error: any) {
    clog.logPipelineError('Gemini Document', error.message);
    log.warning('Gemini Document analysis failed', error.message);
    return fallback;
  }
}

// ============================================
// ENHANCED AI PROMPT (token-optimised)
// ============================================

function buildPrompt(content: string, sender: string): string {
  return `Classify this WhatsApp message and extract action items.

FROM: ${sender}
MSG: ${content}

Return ONLY JSON:
{
  "category": "work|study|personal|urgent|casual|spam",
  "priority": "high|medium|low|none",
  "decision": "create|review|ignore",
  "reasoning": "1 sentence why",
  "suggestedTask": "task title or null",
  "deadline": "extracted deadline string or null",
  "actionItems": [{"title":"...","description":"...","dueDate":"YYYY-MM-DD","dueTime":"HH:MM","priority":"urgent|high|medium|low","type":"meeting|deadline|reminder|task|followup|call|other","assignee":"..."}]
}

Rules:
- work = meetings, reports, deadlines, professional, client
- study = exams, assignments, lectures, academic
- personal = errands, reminders, appointments, health, bills
- urgent = ASAP/emergency/critical/same-day
- casual = greetings, jokes, memes, social chat
- spam = promotions, forwarded chains, marketing
- decision: "create" if actionable, "review" if uncertain, "ignore" if casual/spam
- Extract EVERY actionable item (meetings, deadlines, calls, reminders, tasks)
- Multiple actions in one message = multiple items in array
- If no actions, return empty actionItems array`;
}

// ============================================
// HYBRID CLASSIFY — rules first, AI only when needed
// ============================================

export async function classifyWithAI(content: string, sender: string): Promise<ClassificationResult> {
  // ---- STEP 1: Enhanced rule-based pre-filter ----
  const ruleResult = ruleBasedClassify(content);
  const decision = makeDecision(ruleResult, content.length);

  // Map enhanced rule-based categories to service categories
  const categoryMap: Record<string, ClassificationResult['category']> = {
    'work': 'work',
    'study': 'study',
    'personal': 'personal',
    'urgent': 'urgent',
    'spam': 'spam',
    'ignore': 'casual',
  };

  const priorityMap: Record<string, ClassificationResult['priority']> = {
    'urgent': 'high',
    'high': 'high',
    'medium': 'medium',
    'low': 'low',
  };

  // Rule-based runs first to extract signals (keywords, priority, deadlines)
  // but we ALWAYS pass to Gemini for the final word — no confidence bypass.
  // Short messages and media-only are the only exceptions (no point sending to AI).

  // Short messages (< 12 chars) — rules are enough
  if (content.length < 12) {
    ruleOnlyCount++;
    clog.logRuleBasedResult(categoryMap[ruleResult.category] || 'casual', priorityMap[ruleResult.priority] || 'low', decision, ruleResult.confidence, ['short msg']);
    return {
      category: categoryMap[ruleResult.category] || 'casual',
      priority: decision === 'ignore' ? 'none' : (priorityMap[ruleResult.priority] || 'low'),
      decision,
      reasoning: `Rule-based (short message, ${ruleResult.confidence.toFixed(2)})`,
      actionItems: [],
    };
  }

  // Media-only messages — skip AI
  if (content === '[Media/No Content]' || content === '[Media]') {
    ruleOnlyCount++;
    clog.logIgnored('Media-only message — no text to classify');
    return {
      category: 'casual',
      priority: 'none',
      decision: 'review',
      reasoning: 'Media message without text',
      actionItems: [],
    };
  }

  // ---- STEP 2: Try ML classifier (free, fast, ~97% accuracy) ----
  if (isMLClassifierReady()) {
    const mlResult = classifyWithML(content);
    if (mlResult && mlResult.confidence >= 0.80) {
      mlCallCount++;
      const mlCategory = categoryMap[mlResult.category] || 'casual';
      const mlPriority = priorityMap[mlResult.priority] || 'low';
      const mlDecision = mlResult.has_action_verb || mlResult.has_deadline
        ? 'create' as const
        : mlResult.confidence >= 0.9
          ? (mlResult.category === 'ignore' ? 'ignore' as const : 'create' as const)
          : 'review' as const;

      // Extract basic action items from ML classification
      const mlActionItems: ExtractedActionItem[] = [];
      if (mlDecision === 'create' && content.length > 15) {
        mlActionItems.push({
          title: content.slice(0, 80),
          priority: mlPriority === 'high' ? 'high' : 'medium',
          type: mlResult.has_deadline ? 'deadline' : 'task',
        });
      }

      clog.logMLResult(mlCategory, mlPriority, mlDecision, mlResult.confidence, mlResult.inference_time_ms, mlCallCount);
      log.info('ML Classification',
        `${mlCategory} | ${mlPriority} | ${mlDecision} | conf=${mlResult.confidence.toFixed(2)} | ${mlResult.inference_time_ms}ms [ML call #${mlCallCount}]`);

      return {
        category: mlCategory,
        priority: mlDecision === 'ignore' ? 'none' : mlPriority,
        decision: mlDecision,
        reasoning: `ML model (${mlResult.confidence.toFixed(2)}): ${mlResult.keywords_matched.slice(0, 5).join(', ') || 'pattern match'}`,
        suggestedTask: mlDecision === 'create' ? content.slice(0, 80) : undefined,
        deadline: mlResult.has_deadline ? 'detected' : undefined,
        actionItems: mlActionItems,
      };
    }
  }

  // ---- STEP 3: Call Gemini AI for uncertain cases ----
  if (!model) {
    // No AI available — use ML or rule result as-is
    const mlFallback = isMLClassifierReady() ? classifyWithML(content) : null;
    if (mlFallback) {
      mlCallCount++;
      clog.logFallback(`No Gemini — using ML fallback (conf=${mlFallback.confidence.toFixed(2)})`);
      return {
        category: categoryMap[mlFallback.category] || 'personal',
        priority: priorityMap[mlFallback.priority] || 'low',
        decision,
        reasoning: `ML fallback (no Gemini, conf=${mlFallback.confidence.toFixed(2)}): ${mlFallback.keywords_matched.join(', ')}`,
        actionItems: [],
      };
    }
    clog.logFallback('No Gemini, no ML — using rule-based fallback');
    ruleOnlyCount++;
    return {
      category: categoryMap[ruleResult.category] || 'personal',
      priority: priorityMap[ruleResult.priority] || 'low',
      decision,
      reasoning: `Rule-based fallback (no AI): ${ruleResult.keywords_matched.join(', ')}`,
      actionItems: [],
    };
  }

  try {
    aiCallCount++;
    clog.logEscalatingToGemini(`rule conf=${ruleResult.confidence.toFixed(2)}, ML low/unavailable`);
    const prompt = buildPrompt(content, sender);

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      const actionItemCount = parsed.actionItems?.length || 0;
      clog.logGeminiResult(parsed.category || 'casual', parsed.priority || 'low', parsed.decision || 'review', actionItemCount, aiCallCount);
      log.info('AI Classification', 
        `${parsed.category} | ${parsed.priority} | ${parsed.decision} | ${actionItemCount} actions [AI call #${aiCallCount}]`);
      
      return {
        category: parsed.category || 'casual',
        priority: parsed.priority || 'low',
        decision: parsed.decision || 'review',
        reasoning: parsed.reasoning || 'AI classified',
        suggestedTask: parsed.suggestedTask,
        deadline: parsed.deadline,
        actionItems: parsed.actionItems || [],
      };
    }
  } catch (error: any) {
    clog.logPipelineError('Gemini', error.message);
    log.warning('AI classification failed', error.message);
  }

  // ---- STEP 4: Fallback to ML then rules if AI fails ----
  const mlLastResort = isMLClassifierReady() ? classifyWithML(content) : null;
  if (mlLastResort) {
    mlCallCount++;
    clog.logFallback(`Gemini failed — ML rescue (conf=${mlLastResort.confidence.toFixed(2)})`);
    return {
      category: categoryMap[mlLastResort.category] || 'personal',
      priority: priorityMap[mlLastResort.priority] || 'low',
      decision,
      reasoning: `ML fallback (AI failed, conf=${mlLastResort.confidence.toFixed(2)}): ${mlLastResort.keywords_matched.join(', ')}`,
      actionItems: [],
    };
  }

  ruleOnlyCount++;
  clog.logFallback('All classifiers failed — using rule-based fallback');
  return {
    category: categoryMap[ruleResult.category] || 'personal',
    priority: priorityMap[ruleResult.priority] || 'low',
    decision,
    reasoning: `Rule-based fallback (AI failed): ${ruleResult.keywords_matched.join(', ')}`,
    actionItems: [],
  };
}

// Pure rule-based classification (for use when AI is explicitly unwanted)
export function classifyWithRules(content: string): ClassificationResult {
  const ruleResult = ruleBasedClassify(content);
  const decision = makeDecision(ruleResult, content.length);

  const categoryMap: Record<string, ClassificationResult['category']> = {
    'work': 'work', 'study': 'study', 'personal': 'personal', 'urgent': 'urgent', 'spam': 'spam', 'ignore': 'casual',
  };
  const priorityMap: Record<string, ClassificationResult['priority']> = {
    'urgent': 'high', 'high': 'high', 'medium': 'medium', 'low': 'low',
  };

  return {
    category: categoryMap[ruleResult.category] || 'casual',
    priority: decision === 'ignore' ? 'none' : (priorityMap[ruleResult.priority] || 'low'),
    decision,
    reasoning: `Rule-based (${ruleResult.confidence.toFixed(2)}): [${ruleResult.keywords_matched.join(', ')}]`,
    suggestedTask: decision === 'create' ? content.slice(0, 80) : undefined,
    actionItems: [],
  };
}

// Get classifier stats
export function getClassifierStats() {
  return {
    aiCalls: aiCallCount,
    mlCalls: mlCallCount,
    ruleOnly: ruleOnlyCount,
    visionCalls: visionCallCount,
    total: aiCallCount + mlCallCount + ruleOnlyCount,
    mlStatus: getMLClassifierStatus(),
  };
}

// Initialize ML classifier (call at startup)
export { initMLClassifier } from '../classifier/ml';

export default { initGemini, classifyWithAI, classifyWithRules, getClassifierStats };
