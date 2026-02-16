# ServiceHub - Service Status & Support Platform

## Overview
A comprehensive service status monitoring and support platform where customers can track service health, receive alerts, read news, and submit support tickets with real-time messaging. Admins have full portal control over users, services, alerts, and news.

## Architecture
- **Frontend**: React + Vite + TailwindCSS + Shadcn UI + Wouter routing
- **Backend**: Express.js with session-based auth (scrypt password hashing)
- **Database**: PostgreSQL via Drizzle ORM
- **Real-time**: WebSocket for ticket messaging
- **File uploads**: Multer (stored in /uploads directory)

## Key Features
- Local auth (username/password) with admin-managed credentials
- Service status monitoring with subscriptions
- Service alerts with timeline updates
- News stories with photo support
- Support tickets with real-time messaging (WebSocket)
- Photo uploads for tickets, messages, and news
- Dark/light mode toggle
- Image lightbox for enlarging photos
- Admin portal: user/service/alert/news management

## Default Credentials
- **Admin**: admin / admin123
- **Customer**: jsmith / password123

## Project Structure
```
client/src/
  App.tsx           - Main app with routing, auth, theme providers
  lib/auth.tsx      - Auth context provider
  lib/theme-provider.tsx - Dark/light theme context
  lib/queryClient.ts - TanStack Query setup
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
    tickets-page.tsx - Ticket list with create dialog
    ticket-detail.tsx - Ticket chat with real-time messages
    profile-page.tsx - User profile, theme, service subscriptions
    admin-portal.tsx - Admin tabs: users, services, alerts, news
server/
  index.ts   - Express server entry
  routes.ts  - All API routes + WebSocket + auth middleware
  storage.ts - Database storage interface (Drizzle ORM)
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
- `PATCH /api/auth/profile` - Update subscriptions
- `GET /api/services` - All services
- `GET /api/alerts` - All alerts
- `GET /api/alerts/:id` - Alert detail
- `GET /api/alerts/:id/updates` - Alert updates
- `GET /api/news` - All news
- `GET /api/news/:id` - News detail
- `GET /api/tickets` - User's tickets (or all for admin)
- `POST /api/tickets` - Create ticket (multipart)
- `PATCH /api/tickets/:id` - Update ticket status
- `GET /api/tickets/:id/messages` - Ticket messages
- `POST /api/tickets/:id/messages` - Send message (multipart)
- Admin routes under `/api/admin/...`
