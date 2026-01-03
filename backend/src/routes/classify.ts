/**
 * Classification API Route
 * Classify message content using rule-based and AI classifiers
 */

import { Router } from 'express';

const router = Router();

// Keyword lists for classification
const WORK_KEYWORDS = [
  'meeting', 'deadline', 'project', 'report', 'presentation', 'client',
  'budget', 'proposal', 'schedule', 'conference', 'task', 'deliverable',
  'sprint', 'review', 'approval', 'invoice', 'contract', 'urgent', 'asap', 'priority'
];

const STUDY_KEYWORDS = [
  'assignment', 'exam', 'homework', 'lecture', 'study', 'thesis', 'research',
  'paper', 'quiz', 'test', 'tutorial', 'class', 'course', 'semester', 'grade',
  'professor', 'submit', 'due date', 'chapter', 'textbook'
];

const IGNORE_KEYWORDS = [
  'good morning', 'good night', 'how are you', 'thanks', 'thank you', 'ok',
  'okay', 'lol', 'haha', 'nice', 'cool', 'awesome', 'congratulations',
  'happy birthday', 'good luck', 'take care', 'bye', 'see you', 'offer',
  'discount', 'sale', 'buy now', 'click here', 'forwarded', 'limited time'
];

const URGENCY_KEYWORDS = ['urgent', 'asap', 'immediately', 'emergency', 'critical', 'important', 'now', 'today'];

const ACTION_VERBS = ['send', 'submit', 'complete', 'finish', 'review', 'check', 'prepare', 'create', 'update'];

interface ClassificationResult {
  category: 'work' | 'study' | 'personal' | 'ignore';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  confidence: number;
  keywords_matched: string[];
  has_deadline: boolean;
  has_action_verb: boolean;
  decision: 'create' | 'ignore' | 'review';
}

function classifyMessage(content: string): ClassificationResult {
  const lowerContent = content.toLowerCase();
  
  const workMatches: string[] = [];
  const studyMatches: string[] = [];
  const ignoreMatches: string[] = [];
  const urgencyMatches: string[] = [];
  const actionMatches: string[] = [];

  // Check keywords
  WORK_KEYWORDS.forEach(k => { if (lowerContent.includes(k)) workMatches.push(k); });
  STUDY_KEYWORDS.forEach(k => { if (lowerContent.includes(k)) studyMatches.push(k); });
  IGNORE_KEYWORDS.forEach(k => { if (lowerContent.includes(k)) ignoreMatches.push(k); });
  URGENCY_KEYWORDS.forEach(k => { if (lowerContent.includes(k)) urgencyMatches.push(k); });
  ACTION_VERBS.forEach(k => { if (lowerContent.includes(k)) actionMatches.push(k); });

  // Check for deadline patterns
  const deadlinePatterns = /tomorrow|today|by\s+\w+day|deadline|due|next week|end of/i;
  const has_deadline = deadlinePatterns.test(content);

  // Determine category
  let category: 'work' | 'study' | 'personal' | 'ignore';
  let confidence: number;
  let keywords_matched: string[];

  if (ignoreMatches.length > 0 && workMatches.length === 0 && studyMatches.length === 0) {
    category = 'ignore';
    confidence = 0.9;
    keywords_matched = ignoreMatches;
  } else if (workMatches.length > studyMatches.length) {
    category = 'work';
    confidence = Math.min(0.5 + workMatches.length * 0.1, 1);
    keywords_matched = workMatches;
  } else if (studyMatches.length > workMatches.length) {
    category = 'study';
    confidence = Math.min(0.5 + studyMatches.length * 0.1, 1);
    keywords_matched = studyMatches;
  } else if (workMatches.length > 0 && studyMatches.length > 0) {
    category = 'work';
    confidence = 0.6;
    keywords_matched = [...workMatches, ...studyMatches];
  } else {
    category = 'personal';
    confidence = 0.3;
    keywords_matched = [];
  }

  // Boost confidence for deadlines and action verbs
  if (has_deadline && category !== 'ignore') confidence = Math.min(confidence + 0.1, 1);
  if (actionMatches.length > 0 && category !== 'ignore') confidence = Math.min(confidence + 0.1, 1);

  // Determine priority
  let priority: 'urgent' | 'high' | 'medium' | 'low';
  if (urgencyMatches.length > 0) {
    priority = 'urgent';
  } else if (has_deadline) {
    priority = 'high';
  } else if (actionMatches.length > 0) {
    priority = 'medium';
  } else {
    priority = 'low';
  }

  // Make decision
  let decision: 'create' | 'ignore' | 'review';
  if (category === 'ignore' && confidence >= 0.7) {
    decision = 'ignore';
  } else if ((category === 'work' || category === 'study') && confidence >= 0.6) {
    decision = 'create';
  } else if (content.length < 10) {
    decision = 'ignore';
  } else {
    decision = 'review';
  }

  return {
    category,
    priority,
    confidence: Math.round(confidence * 100) / 100,
    keywords_matched,
    has_deadline,
    has_action_verb: actionMatches.length > 0,
    decision
  };
}

// POST /api/classify - Classify a message
router.post('/', async (req, res) => {
  try {
    const { content, sender, chat_name } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'content is required'
      });
    }

    const result = classifyMessage(content);

    res.json({
      success: true,
      data: {
        input: {
          content,
          sender: sender || null,
          chat_name: chat_name || null
        },
        classification: result,
        method: 'rule-based'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/classify/batch - Classify multiple messages
router.post('/batch', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'messages array is required'
      });
    }

    const results = messages.map((msg: any) => ({
      input: msg,
      classification: classifyMessage(msg.content || ''),
      method: 'rule-based'
    }));

    res.json({
      success: true,
      data: results,
      count: results.length
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
