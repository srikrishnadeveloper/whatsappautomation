// Keyword lists for message classification

export const WORK_KEYWORDS = [
  'meeting',
  'deadline',
  'project',
  'report',
  'presentation',
  'client',
  'budget',
  'proposal',
  'schedule',
  'conference',
  'task',
  'deliverable',
  'sprint',
  'review',
  'approval',
  'invoice',
  'contract',
  'urgent',
  'asap',
  'priority'
];

export const STUDY_KEYWORDS = [
  'assignment',
  'exam',
  'homework',
  'lecture',
  'study',
  'thesis',
  'research',
  'paper',
  'quiz',
  'test',
  'tutorial',
  'class',
  'course',
  'semester',
  'grade',
  'professor',
  'submit',
  'due date',
  'chapter',
  'textbook'
];

export const IGNORE_KEYWORDS = [
  'good morning',
  'good night',
  'how are you',
  'thanks',
  'thank you',
  'ok',
  'okay',
  'lol',
  'haha',
  'nice',
  'cool',
  'awesome',
  'congratulations',
  'happy birthday',
  'good luck',
  'take care',
  'bye',
  'see you',
  'offer',
  'discount',
  'sale',
  'buy now',
  'click here',
  'forwarded',
  'limited time',
  'free',
  'prize',
  'winner',
  'claim now'
];

export const URGENCY_KEYWORDS = [
  'urgent',
  'asap',
  'immediately',
  'emergency',
  'critical',
  'important',
  'now',
  'today',
  'tonight',
  'this morning',
  'this evening'
];

export const DEADLINE_KEYWORDS = [
  'deadline',
  'due',
  'submit',
  'send',
  'deliver',
  'by',
  'before',
  'until',
  'expires',
  'tomorrow',
  'tonight',
  'today',
  'this week',
  'next week',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
];

// Action verbs that indicate tasks
export const ACTION_VERBS = [
  'submit',
  'send',
  'complete',
  'finish',
  'prepare',
  'review',
  'check',
  'update',
  'create',
  'make',
  'write',
  'call',
  'email',
  'schedule',
  'book',
  'arrange',
  'organize',
  'plan',
  'attend',
  'join'
];

export interface ClassificationResult {
  category: 'work' | 'study' | 'personal' | 'ignore';
  confidence: number; // 0-1
  keywords_matched: string[];
  has_deadline: boolean;
  has_action_verb: boolean;
  priority: 'urgent' | 'high' | 'medium' | 'low';
}
