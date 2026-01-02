# Application UI Overview

This document describes the current User Interface (UI) of the application, which is being refactored to follow a **Superhuman/Linear-style** design philosophy: clean, dense, soft shadows, glassmorphism, and high-density information scanning.

## Design System Key Elements
- **Typography**: Inter font, tight tracking for headers, muted secondary text (`--text-muted`).
- **Layout**: Centered content (`max-w-5xl`), grid-based or dense lists, soft shadows (`soft-card`).
- **Components**:
  - **Cards**: White background, subtle border, soft shadow (`soft-card`).
  - **Inputs**: Clean borders, focus rings (`focus:ring-2`), pill-shaped or rounded corners.
  - **Lists**: Dense rows with hover effects (`hover:bg-[var(--bg-surface-soft)]`), custom checkboxes.
  - **Indicators**: Small colored dots for status/priority, pill badges for categories.

---

## Pages

### 1. Login (`/login`)
**Purpose**: User authentication.
- **Layout**: Centered single column.
- **Header**: Mindline Logo image, "Log in to Mindline" heading.
- **Form**:
  - Email and Password fields (minimal styling).
  - "Continue with email" button (primary action).
- **Footer**: Link to Register page.
- **Style**: Distraction-free, whitespace-heavy.

### 2. Register (`/register`)
**Purpose**: New user account creation.
- **Layout**: Centered single column (matches Login).
- **Header**: Mindline Logo image, "Create your account" heading.
- **Form**:
  - Full Name, Email, Password, Confirm Password fields.
  - "Create account" button.
- **Success State**: Simple green checkmark icon with "Account created" text.
- **Footer**: Link to Login page.

### 3. Dashboard (`/dashboard`)
**Purpose**: Overview of recent activity and inbox.
- **Layout**: Grid-based layout.
- **Header**: "Dashboard" title with date.
- **Content**:
  - **Stats**: Grid of 4 cards (Total Tasks, Pending, Completed, Messages) with trend indicators.
  - **Recent Tasks**: A list of recent tasks with priority dots and status.
- **Style**: Soft shadows, clean typography, "soft" aesthetic.

### 4. Tasks (`/tasks`)
**Purpose**: Task management.
- **Layout**: Sectioned list view (Today, Upcoming, Later).
- **Header**: "Tasks" title with "New Task" button.
- **Filters**: Pill-based filters (All, High, Medium, Low).
- **List**:
  - **Rows**: `TaskRow` component with custom circular checkbox.
  - **Columns**: Checkbox, Title, Priority badge, Due Date, Actions.
  - **Interaction**: Hover reveals actions. Click expands for details.
- **Style**: Clean, dense, "Linear-like" task list.

### 5. Action Items (`/action-items`)
**Purpose**: Review and manage AI-extracted action items.
- **Layout**: List view similar to Tasks.
- **Header**: "Action Items" title.
- **List**:
  - **Rows**: `ActionItemRow` component.
  - **Content**: Extracted text, confidence score (subtle text), source message link.
  - **Actions**: "Convert to Task" button (minimal).
- **Modal**: Simplified edit form using `notion-input` styles for refining items before creation.

### 6. Messages (`/messages`)
**Purpose**: View WhatsApp message history and AI analysis.
- **Layout**: Chronological log with sticky controls.
- **Header**: "Messages" title with total count.
- **Filters**: Sticky bar with Search and Dropdown filters (Category, Priority).
- **List**:
  - **Rows**: `MessageRow` component.
  - **Content**: Sender avatar, name, message preview, timestamp, priority dot.
  - **Expansion**: Clicking a row reveals full message content, AI analysis, and classification controls.
- **Style**: Clean, dense, "Superhuman-like" email list style.

### 7. Connect (`/connect`)
**Purpose**: WhatsApp connection management.
- **Layout**: Centered soft-card layout (`max-w-2xl`).
- **Header**: "Connect WhatsApp" title and subtitle.
- **States**:
  - **Disconnected**: Clean card with "Connect" button.
  - **QR Code**: Centered QR code with clear instructions.
  - **Connected**: Status indicator (green dot), User info, "Disconnect" button.
- **Activity Log**: Terminal-like log of connection events.
- **Style**: Soft shadows, glassmorphism effects, clean typography.

### 8. Settings (`/settings`)
**Purpose**: Application configuration.
- **Layout**: Vertical document sections.
- **Header**: "Settings" title.
- **Structure**:
  - **Sections**: "System Status", "Preferences", "Account" (uppercase, tracking-wide headers).
  - **Controls**: Minimal toggle switches and text inputs.
  - **Status**: Colored dots indicating system health (Database, WhatsApp, AI Service).
- **Style**: Clean, readable, easy to scan.
