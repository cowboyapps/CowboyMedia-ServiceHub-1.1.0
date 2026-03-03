# ServiceHub - Service Status & Support Platform

## Overview
A comprehensive service status monitoring and support platform built as a Progressive Web App (PWA). Customers can track service health, receive push notifications for alerts, read news, and submit support tickets with real-time messaging. Admins have full portal control over users, services, alerts, and news. Installable on iOS and Android home screens for a native app experience.

## Architecture
- **Frontend**: React + Vite + TailwindCSS + Shadcn UI + Wouter routing
- **Backend**: Express.js with session-based auth (scrypt password hashing)
- **Database**: PostgreSQL via Drizzle ORM
- **Real-time**: WebSocket for ticket messaging + admin chat
- **File uploads**: Multer (memory storage) → saved to PostgreSQL `uploaded_files` table as base64
- **PWA**: Service Worker + Web App Manifest for installable mobile experience
- **Push Notifications**: Web Push API (VAPID) only — no OneSignal or Firebase
- **Email**: SendGrid integration for transactional emails (noreply@cowboymedia.net)

## Key Features
- Progressive Web App (installable on iOS/Android)
- Push notifications via VAPID Web Push for service alerts and ticket updates
- Ticket notification badge in sidebar (for both admins and customers)
- Local auth (username/password) with admin-managed credentials
- **Admin role system**: master_admin (full access) + custom admin roles with granular permissions
- **Ticket categories**: Category-based access control scoping which admins can see/claim/interact with tickets
- **Admin chat**: Real-time messaging between admins with threads and file/image/video attachments
- Service status monitoring with subscriptions
- **Auto service status sync**: Creating alerts automatically sets service status (degraded/outage/maintenance); resolving alerts restores service to operational
- **Consolidated alert notifications**: Single push + email per event (creation, update, resolution) to all subscribed users (customers and admins), including service status context
- Service alerts with timeline updates
- News stories with photo support
- Support tickets with real-time messaging (WebSocket)
- Photo uploads for tickets, messages, and news
- Dark/light mode toggle
- Image lightbox for enlarging photos
- Admin portal: user/service/alert/news/private-message management
- Private messaging: admin can send private messages to customers (push + email + in-app popup)
- Customer message center with unread badge in sidebar
- Setup reminder system: in-app dialog on every app open + one-time email 2 days after registration if push/services not configured
- **Broadcast priority alerts**: Master admin can send broadcast push messages to selected admins; messages persist in DB and show as mandatory full-screen dialog that must be acknowledged before dismissal
- Mobile-responsive design with safe area support

## Admin Role System
- **master_admin**: Full access to everything, bypasses all permission checks
- **admin**: Regular admin with permissions defined by their assigned `adminRoleId`
- **customer**: Standard customer user

### Permission Keys (stored as text array on `adminRoles` table)
- `users.view`, `users.manage` — Users card
- `services.view`, `services.manage` — Services card
- `alerts.view`, `alerts.manage` — Alerts card
- `news.view`, `news.manage` — News card
- `messages.view`, `messages.manage` — Private Messages card
- `quick_responses.view`, `quick_responses.manage` — Quick Responses card
- `service_updates.view`, `service_updates.manage` — Service Updates card
- `reports.view`, `reports.manage` — Reports/Requests card
- `email_templates.view`, `email_templates.manage` — Email Templates card
- `admin_chat` — Can use Admin Chat
- `support_tickets` — Base ticket access (further scoped by ticket categories)

### Ticket Category Access
- Categories have `assignedRoleIds` — only admins whose `adminRoleId` matches can see/claim/message tickets in that category
- master_admin always sees all tickets regardless of category
- Uncategorized tickets (no categoryId) are visible to all admins

## Default Credentials
- **Master Admin**: admin / admin123
- **Customer**: jsmith / password123

## Project Structure
```
client/
  public/
    manifest.json    - PWA manifest for installability
    sw.js            - Service worker for offline + push notifications
    icons/           - App icons (48-1024px)
  src/
    main.tsx         - Entry point (registers service worker)
    App.tsx          - Main app with routing, auth, theme providers
    lib/
      auth.tsx       - Auth context provider (isAdmin, isMasterAdmin, hasPermission)
      theme-provider.tsx - Dark/light theme context
      queryClient.ts - TanStack Query setup
      push-notifications.ts - VAPID push notification subscription helpers
    components/
      app-sidebar.tsx  - Navigation sidebar with unread badges (tickets + messages)
      theme-toggle.tsx - Dark/light mode toggle
      image-lightbox.tsx - Clickable image with dialog zoom
    pages/
      auth-page.tsx    - Login/Register
      dashboard.tsx    - Overview dashboard
      services-page.tsx - Service status grid
      alerts-page.tsx  - Alert list (active/resolved tabs)
      alert-detail.tsx - Alert detail with update timeline
      news-page.tsx    - News list
      news-detail.tsx  - News article detail
      tickets-page.tsx - Ticket list with create dialog (category dropdown) + admin delete + marks notifications read
      ticket-detail.tsx - Ticket chat with real-time messages + resolution prompt + admin quick response dropdown + category badge
      profile-page.tsx - User profile, fullName update, billing link, theme, push notifications, service subscriptions
      service-updates-page.tsx - Service updates list with per-user dismiss (customers) / delete (admins) + mature content warning overlay
      report-request-page.tsx - Report content issues, request movies/series, or report app issues/feature requests (with image/video attachment)
      admin-portal.tsx - Admin tile cards with permission-gated visibility; includes Admin Management (master_admin only) and Admin Chat tiles
server/
  index.ts   - Express server entry
  routes.ts  - All API routes + WebSocket + push notifications + email notifications + auth middleware + permission middleware
  storage.ts - Database storage interface (Drizzle ORM) — includes admin roles, ticket categories, admin chat CRUD
  email.ts   - SendGrid email utility (transactional emails) + renderTemplate() + default template definitions + seeder
  db.ts      - Database connection
  seed.ts    - Seed data for initial setup
shared/
  schema.ts  - Drizzle schema + Zod validation + TypeScript types (includes adminRoles, ticketCategories, adminChatThreads/Participants/Messages)
```

## Database Tables
- `users` — id, username, password, email, fullName, role (customer/admin/master_admin), adminRoleId, subscribedServices, theme, emailNotifications, createdAt, setupReminderDismissed, setupReminderEmailSent
- `services` — id, name, description, category, status, createdAt
- `service_alerts` — id, title, description, severity, status, serviceId, createdAt, resolvedAt
- `alert_updates` — id, alertId, message, status, createdAt
- `news_stories` — id, title, content, imageUrl, authorId, createdAt
- `tickets` — id, subject, description, serviceId, categoryId, status, priority, customerId, claimedBy, imageUrl, createdAt, closedAt
- `ticket_messages` — id, ticketId, senderId, message, imageUrl, createdAt
- `private_messages` — id, recipientId, senderId, subject, body, readAt, createdAt
- `ticket_notifications` — id, userId, ticketId, type, message, readAt, createdAt
- `push_subscriptions` — id, userId, endpoint, p256dh, auth
- `quick_responses` — id, title, message, createdAt
- `report_requests` — id, type, title, description, serviceId, customerId, imageUrl, status, adminNotes, createdAt
- `report_notifications` — id, userId, reportRequestId, type, message, readAt, createdAt
- `content_notifications` — id, userId, category, message, referenceId, readAt, createdAt
- `service_updates` — id, title, content, imageUrl, matureContent, authorId, createdAt
- `hidden_service_updates` — id, userId, serviceUpdateId
- `uploaded_files` — id, filename, mimetype, data, createdAt
- `email_templates` — id, templateKey, name, subject, body, description, availableVariables, enabled
- `admin_roles` — id, name, permissions (text[]), createdAt
- `ticket_categories` — id, name, description, assignedRoleIds (text[]), createdAt
- `admin_chat_threads` — id, name, createdBy, createdAt
- `admin_chat_participants` — id, threadId, userId, joinedAt
- `admin_chat_messages` — id, threadId, senderId, message, fileUrl, fileType, createdAt
- `broadcast_messages` — id, title, message, senderId, createdAt
- `broadcast_recipients` — id, broadcastId, recipientId, readAt, createdAt

## API Routes
- `POST /api/auth/register` - Customer registration
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Current user
- `PATCH /api/auth/profile` - Update fullName and subscriptions
- `GET /api/services` - All services
- `GET /api/alerts` - All alerts
- `GET /api/alerts/:id` - Alert detail
- `GET /api/alerts/:id/updates` - Alert updates
- `GET /api/news` - All news
- `GET /api/news/:id` - News detail
- `GET /api/tickets` - User's tickets (or filtered by category access for admin)
- `POST /api/tickets` - Create ticket (multipart, accepts categoryId, sends push+email to category-authorized admins)
- `PATCH /api/tickets/:id` - Update ticket status (notifies category-authorized admins on close)
- `POST /api/tickets/:id/claim` - Claim ticket (category access enforced)
- `GET /api/tickets/:id/messages` - Ticket messages (category access enforced)
- `POST /api/tickets/:id/messages` - Send message (multipart, master_admin can interject with "joined" system message)
- `GET /api/ticket-categories` - List all ticket categories (any authenticated user)
- `DELETE /api/admin/tickets/:id` - Delete closed ticket (admin only)
- `DELETE /api/admin/alerts/:id` - Delete alert and updates (admin only)
- `POST /api/admin/private-messages` - Send private message to customer (admin only)
- `GET /api/admin/private-messages/sent` - Get admin's sent messages
- `DELETE /api/admin/private-messages/:id` - Delete sent message (admin only)
- `GET /api/admin/my-permissions` - Get current admin's permission list
- `GET /api/admin/roles` - List all admin roles
- `POST /api/admin/roles` - Create admin role (master_admin only)
- `PATCH /api/admin/roles/:id` - Update admin role (master_admin only)
- `DELETE /api/admin/roles/:id` - Delete admin role (master_admin only)
- `POST /api/admin/ticket-categories` - Create ticket category (master_admin only)
- `PATCH /api/admin/ticket-categories/:id` - Update ticket category (master_admin only)
- `DELETE /api/admin/ticket-categories/:id` - Delete ticket category (master_admin only)
- `POST /api/admin/broadcast-push` - Send broadcast push to selected admin user IDs, persists message (master_admin only)
- `GET /api/broadcasts/unread` - Get unread broadcast messages for current user
- `POST /api/broadcasts/:id/acknowledge` - Acknowledge (mark read) a broadcast message
- `PATCH /api/admin/users/:id/role` - Update user role and adminRoleId (master_admin only)
- `GET /api/admin/chat/threads` - List admin chat threads
- `POST /api/admin/chat/threads` - Create admin chat thread
- `GET /api/admin/chat/threads/:id/messages` - Get thread messages
- `POST /api/admin/chat/threads/:id/messages` - Send chat message with optional file attachment
- `GET /api/admin/quick-responses` - Get all quick responses (admin only)
- `POST /api/admin/quick-responses` - Create quick response (admin only)
- `PATCH /api/admin/quick-responses/:id` - Update quick response (admin only)
- `DELETE /api/admin/quick-responses/:id` - Delete quick response (admin only)
- `GET /api/quick-responses` - Get all quick responses (for ticket reply dropdown)
- `GET /api/private-messages` - Get current user's private messages
- `GET /api/private-messages/unread-count` - Get unread message count
- `DELETE /api/private-messages/:id` - Delete own private message
- `PATCH /api/private-messages/:id/read` - Mark message as read
- `GET /api/ticket-notifications/unread-count` - Get unread ticket notification count
- `POST /api/ticket-notifications/mark-read` - Mark all ticket notifications as read
- `GET /api/service-updates` - Get all service updates
- `POST /api/admin/service-updates` - Create service update (admin only)
- `DELETE /api/service-updates/:id` - Admin: permanently delete; Customer: hide for that user only
- `GET /api/content-notifications/counts` - Get unread content notification counts by category
- `GET /api/content-notifications/unread-references/:category` - Get unread notification reference IDs
- `POST /api/content-notifications/mark-read` - Mark content notifications as read for a category
- `POST /api/push/subscribe` - Subscribe to VAPID push notifications
- `POST /api/push/unsubscribe` - Unsubscribe from push notifications
- `GET /api/push/vapid-key` - Get VAPID public key
- `GET /api/admin/email-templates` - List all email templates (admin only)
- `PATCH /api/admin/email-templates/:id` - Update template subject/body/enabled (admin only)
- `POST /api/admin/email-templates/:id/reset` - Reset template to system default (admin only)

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Express session secret
- `VAPID_PUBLIC_KEY` - Web Push VAPID public key
- `VAPID_PRIVATE_KEY` - Web Push VAPID private key (secret)
- `VITE_VAPID_PUBLIC_KEY` - VAPID public key for frontend
- SendGrid configured via Replit connector integration
