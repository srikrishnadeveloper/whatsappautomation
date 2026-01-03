import { GoogleGenerativeAI } from '@google/generative-ai';
import { ClassificationResult } from './keywords';
import { classifyMessage as ruleBasedClassify } from './rule-based';

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');

// Latest Google AI Studio models (September 2025) in order of preference
// Source: https://ai.google.dev/gemini-api/docs/models (Updated: 2025-09-29)
const MODEL_NAMES = [
  'gemini-2.5-flash',              // RECOMMENDED: Fast & intelligent (June 2025)
  'gemini-2.5-flash-lite',         // Fastest, cost-efficient (July 2025)
  'gemini-2.5-pro',                // Most advanced, best reasoning (June 2025)
  'gemini-2.0-flash',              // Second generation workhorse (Feb 2025)
  'gemini-2.0-flash-lite',         // Second gen fast model (Feb 2025)
  'gemini-1.5-flash',              // Legacy fast model (stable)
  'gemini-1.5-pro',                // Legacy capable model (stable)
];

let activeModel: any = null;
let activeModelName: string = '';

async function getModel() {
  if (activeModel) return activeModel;
  
  // Try each model until one works
  for (const modelName of MODEL_NAMES) {
    try {
      const testModel = genAI.getGenerativeModel({ model: modelName });
      // Model created successfully
      console.log(`✅ Using AI model: ${modelName}`);
      activeModel = testModel;
      activeModelName = modelName;
      return testModel;
    } catch (error) {
      console.warn(`⚠️  Model ${modelName} not available, trying next...`);
    }
  }
  
  throw new Error('No Google AI models available. Please check your API key at https://aistudio.google.com/apikey');
}

export function getActiveModelName(): string {
  return activeModelName || 'none';
}

interface AIClassificationResult extends ClassificationResult {
  ai_reasoning: string;
  rule_based_result?: ClassificationResult;
  method: 'ai' | 'rule-based' | 'hybrid';
}

/**
 * Classify message using Google Gemini AI
 * Falls back to rule-based classification if AI fails
 */
export async function classifyMessageWithAI(
  messageContent: string,
  senderName?: string,
  chatName?: string
): Promise<AIClassificationResult> {
  // First, get rule-based classification as fallback
  const ruleBasedResult = ruleBasedClassify(messageContent);

  // If message is too short or clearly spam, skip AI
  if (messageContent.length < 10 || ruleBasedResult.category === 'ignore' && ruleBasedResult.confidence > 0.8) {
    return {
      ...ruleBasedResult,
      ai_reasoning: 'Skipped AI - using rule-based classification (message too short or clearly spam)',
      rule_based_result: ruleBasedResult,
      method: 'rule-based'
    };
  }

  try {
    // Get available model
    const model = await getModel();
    
    // Build context-aware prompt
    const prompt = buildClassificationPrompt(messageContent, senderName, chatName);
    
    // Call Gemini API
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiResponse = response.text();

    // Parse AI response
    const aiClassification = parseAIResponse(aiResponse, ruleBasedResult);

    return {
      ...aiClassification,
      ai_reasoning: aiResponse,
      rule_based_result: ruleBasedResult,
      method: 'ai'
    };

  } catch (error) {
    console.error('❌ AI Classification failed, falling back to rule-based:', error);
    
    return {
      ...ruleBasedResult,
      ai_reasoning: `AI Error: ${error instanceof Error ? error.message : 'Unknown error'}. Used rule-based fallback.`,
      rule_based_result: ruleBasedResult,
      method: 'rule-based'
    };
  }
}

/**
 * Build a structured prompt for the AI model
 */
function buildClassificationPrompt(
  message: string,
  senderName?: string,
  chatName?: string
): string {
  return `You are an AI assistant that classifies WhatsApp messages into task categories.

CONTEXT:
- Message: "${message}"
${senderName ? `- Sender: ${senderName}` : ''}
${chatName ? `- Chat: ${chatName}` : ''}

TASK:
Analyze this message and provide a JSON response with the following fields:

1. category: Choose ONE of: "work", "study", "personal", "ignore"
   - work: Professional tasks, meetings, projects, clients, deadlines
   - study: Academic tasks, exams, assignments, lectures, homework
   - personal: Personal errands, reminders, family matters
   - ignore: Greetings, casual chat, spam, marketing, social pleasantries

2. confidence: A number between 0 and 1 indicating your confidence
   - 0.9-1.0: Very confident (clear task with specific details)
   - 0.7-0.9: Confident (likely a task)
   - 0.5-0.7: Moderate (unclear, could be task or casual)
   - 0.3-0.5: Low (probably casual)
   - 0.0-0.3: Very low (definitely not a task)

3. priority: Choose ONE of: "urgent", "high", "medium", "low"
   - urgent: Time-sensitive (within hours), uses words like "urgent", "asap", "immediately"
   - high: Has a deadline within days, important action items
   - medium: Regular tasks, no immediate deadline
   - low: Non-urgent personal items or reminders

4. keywords: Array of important keywords you identified in the message

5. reasoning: Brief explanation (1-2 sentences) of why you chose this classification

6. is_actionable: Boolean - does this require action/follow-up?

RESPONSE FORMAT (JSON only, no extra text):
{
  "category": "work",
  "confidence": 0.85,
  "priority": "high",
  "keywords": ["report", "deadline"],
  "reasoning": "This is a work-related task with a clear deadline mentioned",
  "is_actionable": true
}

Now classify the message above:`;
}

/**
 * Parse AI response and combine with rule-based results
 */
function parseAIResponse(
  aiResponse: string,
  fallback: ClassificationResult
): AIClassificationResult {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!parsed.category || !parsed.confidence || !parsed.priority) {
      throw new Error('Missing required fields in AI response');
    }

    // Validate category
    const validCategories = ['work', 'study', 'personal', 'ignore'];
    if (!validCategories.includes(parsed.category)) {
      console.warn(`Invalid category from AI: ${parsed.category}, using fallback`);
      return {
        ...fallback,
        ai_reasoning: aiResponse,
        method: 'hybrid'
      };
    }

    // Validate priority
    const validPriorities = ['urgent', 'high', 'medium', 'low'];
    if (!validPriorities.includes(parsed.priority)) {
      parsed.priority = fallback.priority;
    }

    // Ensure confidence is in valid range
    const confidence = Math.max(0, Math.min(1, parsed.confidence));

    // Check for deadline and action verbs in original message
    const messageLC = aiResponse.toLowerCase();
    const has_deadline = parsed.has_deadline !== undefined 
      ? parsed.has_deadline 
      : /deadline|due|by|before|until|tomorrow|today|next week/i.test(aiResponse);
    const has_action_verb = parsed.has_action_verb !== undefined
      ? parsed.has_action_verb
      : /submit|send|complete|finish|prepare|review|check|update/i.test(aiResponse);

    return {
      category: parsed.category,
      confidence: confidence,
      keywords_matched: parsed.keywords || [],
      priority: parsed.priority,
      has_deadline,
      has_action_verb,
      ai_reasoning: parsed.reasoning || aiResponse,
      method: 'ai'
    };

  } catch (error) {
    console.warn('Failed to parse AI response, using fallback:', error);
    return {
      ...fallback,
      ai_reasoning: `Parse Error: ${error instanceof Error ? error.message : 'Unknown'}. ${aiResponse}`,
      method: 'hybrid'
    };
  }
}

/**
 * Hybrid classification: Use AI for uncertain cases, rules for clear cases
 */
export async function hybridClassify(
  messageContent: string,
  senderName?: string,
  chatName?: string
): Promise<AIClassificationResult> {
  // Get rule-based result first
  const ruleResult = ruleBasedClassify(messageContent);

  // If rule-based is very confident, use it (save AI calls)
  if (ruleResult.confidence >= 0.8) {
    return {
      ...ruleResult,
      ai_reasoning: 'Used rule-based classification (high confidence)',
      rule_based_result: ruleResult,
      method: 'rule-based'
    };
  }

  // If message is very short, use rules
  if (messageContent.length < 15) {
    return {
      ...ruleResult,
      ai_reasoning: 'Used rule-based classification (message too short for AI)',
      rule_based_result: ruleResult,
      method: 'rule-based'
    };
  }

  // For uncertain cases, use AI
  return await classifyMessageWithAI(messageContent, senderName, chatName);
}

/**
 * Batch classification for multiple messages (useful for processing history)
 */
export async function batchClassifyMessages(
  messages: Array<{ content: string; sender?: string; chat?: string }>
): Promise<AIClassificationResult[]> {
  const results: AIClassificationResult[] = [];

  for (const msg of messages) {
    const result = await hybridClassify(msg.content, msg.sender, msg.chat);
    results.push(result);
    
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}

/**
 * Get AI classification statistics
 */
export function getClassificationStats(results: AIClassificationResult[]) {
  const stats = {
    total: results.length,
    by_method: {
      ai: results.filter(r => r.method === 'ai').length,
      rule_based: results.filter(r => r.method === 'rule-based').length,
      hybrid: results.filter(r => r.method === 'hybrid').length
    },
    by_category: {
      work: results.filter(r => r.category === 'work').length,
      study: results.filter(r => r.category === 'study').length,
      personal: results.filter(r => r.category === 'personal').length,
      ignore: results.filter(r => r.category === 'ignore').length
    },
    by_priority: {
      urgent: results.filter(r => r.priority === 'urgent').length,
      high: results.filter(r => r.priority === 'high').length,
      medium: results.filter(r => r.priority === 'medium').length,
      low: results.filter(r => r.priority === 'low').length
    },
    average_confidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length
  };

  return stats;
}
