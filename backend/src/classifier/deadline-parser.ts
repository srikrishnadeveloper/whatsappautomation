/**
 * Date and time parsing utilities for extracting deadlines from messages
 */

export interface DeadlineInfo {
  found: boolean;
  date: Date | null;
  text: string | null;
  confidence: number;
}

/**
 * Parse deadline from message text
 */
export function parseDeadline(content: string): DeadlineInfo {
  const lowerContent = content.toLowerCase();
  const now = new Date();
  
  // Common date patterns
  const patterns = {
    // "tomorrow", "tonight"
    tomorrow: /\b(tomorrow|tmrw|tmr)\b/i,
    today: /\b(today|tonight|this evening|this morning)\b/i,
    
    // "next monday", "this friday"
    nextDay: /\b(next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    
    // "by friday", "before monday"
    byDay: /\b(by|before|until)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    
    // "in 2 days", "in 3 hours"
    inDuration: /\bin\s+(\d+)\s+(hour|hours|day|days|week|weeks)\b/i,
    
    // "5pm", "3:30pm", "17:00"
    time: /\b(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?\b/,
    
    // "oct 15", "october 15th", "15 october"
    monthDay: /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(st|nd|rd|th)?\b/i,
    
    // "15/10/2025", "10-15-2025", "2025-10-15"
    dateSlash: /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/,
    
    // "end of week", "end of month"
    endOf: /\bend of (week|month|day)\b/i
  };

  // Try each pattern
  
  // Tomorrow
  if (patterns.tomorrow.test(lowerContent)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59);
    return {
      found: true,
      date: tomorrow,
      text: 'tomorrow',
      confidence: 0.9
    };
  }

  // Today
  if (patterns.today.test(lowerContent)) {
    const today = new Date(now);
    today.setHours(23, 59, 59);
    return {
      found: true,
      date: today,
      text: 'today',
      confidence: 0.95
    };
  }

  // Next/This day of week
  const nextDayMatch = lowerContent.match(patterns.nextDay);
  if (nextDayMatch) {
    const dayName = nextDayMatch[2].toLowerCase();
    const targetDate = getNextDayOfWeek(dayName, nextDayMatch[1] === 'next');
    return {
      found: true,
      date: targetDate,
      text: nextDayMatch[0],
      confidence: 0.85
    };
  }

  // By/Before day of week
  const byDayMatch = lowerContent.match(patterns.byDay);
  if (byDayMatch) {
    const dayName = byDayMatch[2].toLowerCase();
    const targetDate = getNextDayOfWeek(dayName, false);
    return {
      found: true,
      date: targetDate,
      text: byDayMatch[0],
      confidence: 0.9
    };
  }

  // In X days/hours
  const inDurationMatch = lowerContent.match(patterns.inDuration);
  if (inDurationMatch) {
    const amount = parseInt(inDurationMatch[1]);
    const unit = inDurationMatch[2].toLowerCase();
    const targetDate = new Date(now);
    
    if (unit.includes('hour')) {
      targetDate.setHours(targetDate.getHours() + amount);
    } else if (unit.includes('day')) {
      targetDate.setDate(targetDate.getDate() + amount);
    } else if (unit.includes('week')) {
      targetDate.setDate(targetDate.getDate() + (amount * 7));
    }
    
    return {
      found: true,
      date: targetDate,
      text: inDurationMatch[0],
      confidence: 0.8
    };
  }

  // End of week/month
  const endOfMatch = lowerContent.match(patterns.endOf);
  if (endOfMatch) {
    const unit = endOfMatch[1].toLowerCase();
    const targetDate = new Date(now);
    
    if (unit === 'week') {
      // Set to Sunday
      targetDate.setDate(targetDate.getDate() + (7 - targetDate.getDay()));
      targetDate.setHours(23, 59, 59);
    } else if (unit === 'month') {
      // Set to last day of month
      targetDate.setMonth(targetDate.getMonth() + 1, 0);
      targetDate.setHours(23, 59, 59);
    } else if (unit === 'day') {
      targetDate.setHours(23, 59, 59);
    }
    
    return {
      found: true,
      date: targetDate,
      text: endOfMatch[0],
      confidence: 0.75
    };
  }

  // Date with slash/dash (DD/MM/YYYY or MM/DD/YYYY)
  const dateSlashMatch = content.match(patterns.dateSlash);
  if (dateSlashMatch) {
    try {
      const part1 = parseInt(dateSlashMatch[1]);
      const part2 = parseInt(dateSlashMatch[2]);
      let year = parseInt(dateSlashMatch[3]);
      
      // Convert 2-digit year to 4-digit
      if (year < 100) {
        year += 2000;
      }
      
      // Assume DD/MM/YYYY format (international)
      const targetDate = new Date(year, part2 - 1, part1);
      
      if (!isNaN(targetDate.getTime())) {
        return {
          found: true,
          date: targetDate,
          text: dateSlashMatch[0],
          confidence: 0.85
        };
      }
    } catch (e) {
      // Invalid date, continue
    }
  }

  // No deadline found
  return {
    found: false,
    date: null,
    text: null,
    confidence: 0
  };
}

/**
 * Get the next occurrence of a day of the week
 */
function getNextDayOfWeek(dayName: string, nextWeek: boolean = false): Date {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = days.indexOf(dayName);
  
  const now = new Date();
  const currentDay = now.getDay();
  
  let daysToAdd = targetDay - currentDay;
  if (daysToAdd <= 0 || nextWeek) {
    daysToAdd += 7;
  }
  
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + daysToAdd);
  targetDate.setHours(23, 59, 59);
  
  return targetDate;
}

/**
 * Extract time from message (e.g., "5pm", "3:30pm")
 */
export function extractTime(content: string): { found: boolean; time: string | null } {
  const timePattern = /\b(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)\b/;
  const match = content.match(timePattern);
  
  if (match) {
    return {
      found: true,
      time: match[0]
    };
  }
  
  return {
    found: false,
    time: null
  };
}

/**
 * Generate a task title from message content
 */
export function generateTaskTitle(content: string, maxLength: number = 60): string {
  // Remove common prefixes
  let title = content
    .replace(/^(hi|hello|hey|please|can you|could you|would you)/i, '')
    .trim();
  
  // Take first sentence
  const firstSentence = title.split(/[.!?]/)[0];
  if (firstSentence) {
    title = firstSentence;
  }
  
  // Truncate if too long
  if (title.length > maxLength) {
    title = title.substring(0, maxLength - 3) + '...';
  }
  
  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1);
  
  return title;
}
