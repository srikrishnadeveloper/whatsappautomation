/**
 * Activity Log Service
 * Broadcasts terminal-like activity to connected clients via SSE
 */

import { Response } from 'express';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'message';
  icon: string;
  title: string;
  details?: string;
  metadata?: any;
}

// Store connected SSE clients
const logClients: Set<Response> = new Set();

// Store recent logs (last 100)
const recentLogs: LogEntry[] = [];
const MAX_LOGS = 100;

// Add a log entry
export function addLog(
  type: LogEntry['type'],
  icon: string,
  title: string,
  details?: string,
  metadata?: any
): LogEntry {
  const entry: LogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    type,
    icon,
    title,
    details,
    metadata
  };

  // Add to recent logs
  recentLogs.unshift(entry);
  if (recentLogs.length > MAX_LOGS) {
    recentLogs.pop();
  }

  // Broadcast to all clients
  broadcastLog(entry);

  // Also log to console
  const consolePrefix = {
    info: '📋',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    message: '📩'
  }[type];
  console.log(`${consolePrefix} [${type.toUpperCase()}] ${title}${details ? ` - ${details}` : ''}`);

  return entry;
}

// Broadcast log to all connected clients
function broadcastLog(entry: LogEntry) {
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  logClients.forEach(client => {
    try {
      client.write(data);
    } catch (e) {
      logClients.delete(client);
    }
  });
}

// Add SSE client
export function addLogClient(res: Response) {
  logClients.add(res);
}

// Remove SSE client
export function removeLogClient(res: Response) {
  logClients.delete(res);
}

// Get recent logs
export function getRecentLogs(): LogEntry[] {
  return [...recentLogs];
}

// Clear logs
export function clearLogs() {
  recentLogs.length = 0;
}

// Convenience methods
export const log = {
  info: (title: string, details?: string, metadata?: any) => 
    addLog('info', 'ℹ️', title, details, metadata),
  
  success: (title: string, details?: string, metadata?: any) => 
    addLog('success', '✅', title, details, metadata),
  
  warning: (title: string, details?: string, metadata?: any) => 
    addLog('warning', '⚠️', title, details, metadata),
  
  error: (title: string, details?: string, metadata?: any) => 
    addLog('error', '❌', title, details, metadata),
  
  message: (sender: string, content: string, classification?: any) => 
    addLog('message', '📩', `Message from ${sender}`, content.substring(0, 100), classification)
};

export default log;
