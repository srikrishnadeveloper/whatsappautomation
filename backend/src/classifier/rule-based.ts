import {
  WORK_KEYWORDS,
  STUDY_KEYWORDS,
  IGNORE_KEYWORDS,
  URGENCY_KEYWORDS,
  DEADLINE_KEYWORDS,
  ACTION_VERBS,
  ClassificationResult
} from './keywords';

/**
 * Classify a message as work, study, personal, or ignore
 */
export function classifyMessage(content: string): ClassificationResult {
  const lowerContent = content.toLowerCase();
  
  // Track matched keywords
  const workMatches: string[] = [];
  const studyMatches: string[] = [];
  const ignoreMatches: string[] = [];
  const urgencyMatches: string[] = [];
  const deadlineMatches: string[] = [];
  const actionMatches: string[] = [];

  // Check for work keywords
  WORK_KEYWORDS.forEach(keyword => {
    if (lowerContent.includes(keyword)) {
      workMatches.push(keyword);
    }
  });

  // Check for study keywords
  STUDY_KEYWORDS.forEach(keyword => {
    if (lowerContent.includes(keyword)) {
      studyMatches.push(keyword);
    }
  });

  // Check for ignore keywords
  IGNORE_KEYWORDS.forEach(keyword => {
    if (lowerContent.includes(keyword)) {
      ignoreMatches.push(keyword);
    }
  });

  // Check for urgency keywords
  URGENCY_KEYWORDS.forEach(keyword => {
    if (lowerContent.includes(keyword)) {
      urgencyMatches.push(keyword);
    }
  });

  // Check for deadline keywords
  DEADLINE_KEYWORDS.forEach(keyword => {
    if (lowerContent.includes(keyword)) {
      deadlineMatches.push(keyword);
    }
  });

  // Check for action verbs
  ACTION_VERBS.forEach(verb => {
    if (lowerContent.includes(verb)) {
      actionMatches.push(verb);
    }
  });

  // Determine category based on matches
  let category: 'work' | 'study' | 'personal' | 'ignore';
  let confidence: number;
  let keywords_matched: string[];

  // If ignore keywords are found (especially greetings/spam)
  if (ignoreMatches.length > 0 && workMatches.length === 0 && studyMatches.length === 0) {
    category = 'ignore';
    confidence = 0.9;
    keywords_matched = ignoreMatches;
  }
  // If work keywords dominate
  else if (workMatches.length > studyMatches.length) {
    category = 'work';
    confidence = Math.min(0.5 + (workMatches.length * 0.1), 1);
    keywords_matched = workMatches;
  }
  // If study keywords dominate
  else if (studyMatches.length > workMatches.length) {
    category = 'study';
    confidence = Math.min(0.5 + (studyMatches.length * 0.1), 1);
    keywords_matched = studyMatches;
  }
  // If both work and study keywords present
  else if (workMatches.length > 0 && studyMatches.length > 0) {
    category = 'work'; // Default to work if ambiguous
    confidence = 0.6;
    keywords_matched = [...workMatches, ...studyMatches];
  }
  // No clear category - needs review
  else {
    category = 'personal';
    confidence = 0.3;
    keywords_matched = [];
  }

  // Determine priority
  let priority: 'urgent' | 'high' | 'medium' | 'low';
  
  if (urgencyMatches.length > 0) {
    priority = 'urgent';
  } else if (deadlineMatches.length > 0 && actionMatches.length > 0) {
    priority = 'high';
  } else if (actionMatches.length > 0 || deadlineMatches.length > 0) {
    priority = 'medium';
  } else {
    priority = 'low';
  }

  return {
    category,
    confidence,
    keywords_matched,
    has_deadline: deadlineMatches.length > 0,
    has_action_verb: actionMatches.length > 0,
    priority
  };
}

/**
 * Make a decision: should this message become a task?
 */
export function makeDecision(
  classification: ClassificationResult,
  messageLength: number
): 'create' | 'ignore' | 'review' {
  
  // Ignore very short messages (likely not tasks)
  if (messageLength < 10) {
    return 'ignore';
  }

  // Ignore if classified as ignore with high confidence
  if (classification.category === 'ignore' && classification.confidence > 0.7) {
    return 'ignore';
  }

  // Create task if work/study with action verb or deadline
  if (
    (classification.category === 'work' || classification.category === 'study') &&
    (classification.has_action_verb || classification.has_deadline) &&
    classification.confidence > 0.5
  ) {
    return 'create';
  }

  // Create task if urgent
  if (classification.priority === 'urgent') {
    return 'create';
  }

  // Review if uncertain
  if (classification.confidence < 0.5) {
    return 'review';
  }

  // Default to ignore for personal messages
  if (classification.category === 'personal') {
    return 'ignore';
  }

  // Review anything that doesn't fit clear patterns
  return 'review';
}
