# ServiceHub - Service Status & Support Platform

## Overview
A comprehensive service status monitoring and support platform built as a Progressive Web App (PWA). Customers can track service health, receive push notifications for alerts, read news, and submit support tickets with real-time messaging. Admins have full portal control over users, services, alerts, and news. Installable on iOS and Android home screens for a native app experience.

## Architecture
- **Frontend**: React + Vite + TailwindCSS + Shadcn UI + Wouter routing
- **Backend**: Express.js with session-based auth (scrypt password hashing)
- **Database**: PostgreSQL via Drizzle ORM
- **Real-time**: WebSocket for ticket messaging
- **File uploads**: Multer (memory storage) → saved to PostgreSQL `uploaded_files` table as base64
- **PWA**: Service Worker + Web App Manifest for installable mobile experience
- **Push Notifications**: Web Push API (VAPID) only — no OneSignal or Firebase
- **Email**: SendGrid integration for transactional emails (noreply@cowboymedia.net)

## Key Features
- Progressive Web App (installable on iOS/Android)
- Push notifications via VAPID Web Push for service alerts and ticket updates
- Ticket notification badge in sidebar (for both admins and customers)
- Local auth (username/password) with admin-managed credentials
- Service status monitoring with subscriptions
- Service alerts with timeline updates
- News stories with photo support
- Support tickets with real-time messaging (WebSocket)
- Photo uploads for tickets, messages, and news
- Dark/light mode toggle
- Image lightbox for enlarging photos
- Admin portal: user/service/alert/news/private-message management
- Private messaging: admin can send private messages to customers (push + email + in-app popup)
- Customer message center with unread badge in sidebar
- Mobile-responsive design with safe area support

## Default Credentials
- **Admin**: admin / admin123
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
      auth.tsx       - Auth context provider
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
      tickets-page.tsx - Ticket list with create dialog + admin delete + marks notifications read
      ticket-detail.tsx - Ticket chat with real-time messages + resolution prompt + admin quick response dropdown
      profile-page.tsx - User profile, fullName update, billing link, theme, push notifications, service subscriptions
      service-updates-page.tsx - Service updates list with delete capability
      report-request-page.tsx - Report content issues or request movies/series
      admin-portal.tsx - Admin tile cards: users, services, alerts, news, messages, quick responses, service updates, reports/requests
server/
  index.ts   - Express server entry
  routes.ts  - All API routes + WebSocket + push notifications + email notifications + auth middleware
  storage.ts - Database storage interface (Drizzle ORM)
  email.ts   - SendGrid email utility (transactional emails)
  db.ts      - Database connection
  seed.ts    - Seed data for initial setup
shared/
  schema.ts  - Drizzle schema + Zod validation + TypeScript types
```

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
- `GET /api/tickets` - User's tickets (or all for admin)
- `POST /api/tickets` - Create ticket (multipart, sends push+email to admins)
- `PATCH /api/tickets/:id` - Update ticket status (notifies admins on close)
- `GET /api/tickets/:id/messages` - Ticket messages
- `POST /api/tickets/:id/messages` - Send message (multipart, sends push+email notifications)
- `DELETE /api/admin/tickets/:id` - Delete closed ticket (admin only)
- `DELETE /api/admin/alerts/:id` - Delete alert and updates (admin only)
- `POST /api/admin/private-messages` - Send private message to customer (admin only, triggers push+email+WS)
- `GET /api/admin/private-messages/sent` - Get admin's sent messages
- `DELETE /api/admin/private-messages/:id` - Delete sent message (admin only, verifies sender)
- `GET /api/admin/quick-responses` - Get all quick responses (admin only)
- `POST /api/admin/quick-responses` - Create quick response (admin only)
- `PATCH /api/admin/quick-responses/:id` - Update quick response (admin only)
- `DELETE /api/admin/quick-responses/:id` - Delete quick response (admin only)
- `GET /api/quick-responses` - Get all quick responses (for ticket reply dropdown)
- `GET /api/private-messages` - Get current user's private messages (enriched with senderName)
- `GET /api/private-messages/unread-count` - Get unread message count
- `DELETE /api/private-messages/:id` - Delete own private message (customer, verifies recipient)
- `PATCH /api/private-messages/:id/read` - Mark message as read
- `GET /api/ticket-notifications/unread-count` - Get unread ticket notification count
- `POST /api/ticket-notifications/mark-read` - Mark all ticket notifications as read
- `GET /api/service-updates` - Get all service updates
- `POST /api/admin/service-updates` - Create service update (admin only, sends push+email to subscribed customers)
- `DELETE /api/service-updates/:id` - Delete service update (any authenticated user)
- `GET /api/content-notifications/counts` - Get unread content notification counts by category
- `POST /api/content-notifications/mark-read` - Mark content notifications as read for a category
- `POST /api/push/subscribe` - Subscribe to VAPID push notifications
- `POST /api/push/unsubscribe` - Unsubscribe from push notifications
- `GET /api/push/vapid-key` - Get VAPID public key
- Admin routes under `/api/admin/...`

## Notification Triggers
- **New ticket created**: VAPID Push + email + in-app badge to all admins
- **Admin replies to ticket**: VAPID Push + email* + in-app badge to customer
- **Customer replies to ticket**: VAPID Push + email + in-app badge to all admins
- **Ticket closed**: VAPID Push + email + in-app badge to all admins
- **New news story posted**: VAPID Push + email* to all customers
- **Service status changed**: VAPID Push + email* to subscribed customers
- **New service alert created**: VAPID Push + email* to subscribed customers
- **Alert updated**: VAPID Push to subscribed customers
- *Customer emails marked with * are only sent if user has emailNotifications enabled (default: true)
- Admin emails are always sent regardless of this setting

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Express session secret
- `VAPID_PUBLIC_KEY` - Web Push VAPID public key
- `VAPID_PRIVATE_KEY` - Web Push VAPID private key (secret)
- `VITE_VAPID_PUBLIC_KEY` - VAPID public key for frontend
- SendGrid configured via Replit connector integration
