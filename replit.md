# ServiceHub - Service Status & Support Platform

## Overview
A comprehensive service status monitoring and support platform built as a Progressive Web App (PWA). Customers can track service health, receive push notifications for alerts, read news, and submit support tickets with real-time messaging. Admins have full portal control over users, services, alerts, and news. Installable on iOS and Android home screens for a native app experience.

## Architecture
- **Frontend**: React + Vite + TailwindCSS + Shadcn UI + Wouter routing
- **Backend**: Express.js with session-based auth (scrypt password hashing)
- **Database**: PostgreSQL via Drizzle ORM
- **Real-time**: WebSocket for ticket messaging
- **File uploads**: Multer (stored in /uploads directory)
- **PWA**: Service Worker + Web App Manifest for installable mobile experience
- **Push Notifications**: Web Push API (VAPID) for alert and ticket notifications
- **Email**: SendGrid integration for transactional emails (noreply@cowboymedia.net)

## Key Features
- Progressive Web App (installable on iOS/Android)
- Push notifications for service alerts and ticket updates
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
    icons/           - App icons (192px, 512px)
  src/
    main.tsx         - Entry point (registers service worker)
    App.tsx          - Main app with routing, auth, theme providers
    lib/
      auth.tsx       - Auth context provider
      theme-provider.tsx - Dark/light theme context
      queryClient.ts - TanStack Query setup
      push-notifications.ts - Push notification subscription helpers
    components/
      app-sidebar.tsx  - Navigation sidebar
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
      tickets-page.tsx - Ticket list with create dialog + admin delete
      ticket-detail.tsx - Ticket chat with real-time messages + resolution prompt
      profile-page.tsx - User profile, fullName update, billing link, theme, push notifications, service subscriptions
      admin-portal.tsx - Admin tabs: users, services, alerts, news
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
- `GET /api/private-messages` - Get current user's private messages (enriched with senderName)
- `GET /api/private-messages/unread-count` - Get unread message count
- `DELETE /api/private-messages/:id` - Delete own private message (customer, verifies recipient)
- `PATCH /api/private-messages/:id/read` - Mark message as read
- `POST /api/push/subscribe` - Subscribe to push notifications
- `POST /api/push/unsubscribe` - Unsubscribe from push notifications
- `GET /api/push/vapid-key` - Get VAPID public key
- Admin routes under `/api/admin/...`

## Notification Triggers
- **New ticket created**: Push + email to all admins with customer details
- **Admin replies to ticket**: Push + email to customer
- **Customer replies to ticket**: Push + email to all admins
- **Ticket closed**: Push + email to all admins
- **New news story posted**: Push + email to all customers
- **Service status changed**: Push + email to subscribed customers
- **New service alert created**: Push + email to subscribed customers
- **Alert updated**: Push to subscribed customers

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Express session secret
- `VAPID_PUBLIC_KEY` - Web Push VAPID public key
- `VAPID_PRIVATE_KEY` - Web Push VAPID private key (secret)
- `VITE_VAPID_PUBLIC_KEY` - VAPID public key for frontend
- SendGrid configured via Replit connector integration
