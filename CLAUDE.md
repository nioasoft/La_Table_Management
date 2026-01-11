# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is a Next.js 15 full-stack React application with the following key architectural patterns:

### Tech Stack

- **Framework**: Next.js 15 with App Router and React 19
- **Language**: TypeScript with strict mode
- **Database**: PostgreSQL with Drizzle ORM for type-safe queries
- **Authentication**: Better Auth with email/password authentication
- **Styling**: Tailwind CSS with shadcn/ui components
- **File Storage**: AWS S3/R2 with presigned URL uploads
- **Payments**: Stripe integration for subscriptions
- **Internationalization**: RTL support for Hebrew language (default)

### Project Structure

- `src/app/` - Next.js App Router pages and layouts
- `src/components/` - Reusable React components with `ui/` subfolder for base components
- `src/db/` - Database configuration and schema definitions
- `src/data-access/` - Data access layer functions
- `src/fn/` - Business logic functions and middleware
- `src/hooks/` - Custom React hooks for data fetching and state management
- `src/queries/` - TanStack Query definitions for server state
- `src/utils/` - Utility functions and helpers
- `src/config/` - Environment and application configuration
- `src/lib/` - Shared libraries and utilities
- `src/styles/` - Global CSS and Tailwind configuration

### Database Schema

Core entities: `user`, with subscription and authentication tables. Users have subscription plans (free/basic/pro).

### Key Patterns

- **Data Fetching**: React Server Components with TanStack Query for client-side state
- **Authentication**: Better Auth with session management
- **File Uploads**: Presigned URLs for direct S3/R2 uploads
- **Subscriptions**: Stripe-based with plan limits enforcement
- **Type Safety**: Full TypeScript with Drizzle ORM schema inference
- **RTL Support**: Default Hebrew language with right-to-left text direction

## Common Development Commands

```bash
# Development
npm run dev                 # Start development server on port 3000 (with Turbopack)
npm run build              # Build for production
npm run start              # Start production server
npm run lint               # Run ESLint

# Database
npm run db:up              # Start PostgreSQL Docker container
npm run db:down            # Stop PostgreSQL Docker container
npm run db:migrate         # Run database migrations
npm run db:generate        # Generate new migration files
npm run db:studio          # Open Drizzle Studio for database management

# Testing
npm run test:e2e           # Run Playwright end-to-end tests

# Payments (if needed)
npm run stripe:listen      # Listen for Stripe webhooks in development
```

## Environment Setup

1. Copy `.env.example` to `.env` and configure:
   - Database connection (PostgreSQL)
   - Better Auth secrets
   - Stripe keys (for payments)
   - AWS S3/R2 credentials (for file storage)
   - Public variables with NEXT_PUBLIC_ prefix

2. Start database and run migrations:
   ```bash
   npm run db:up
   npm run db:migrate
   ```

## Development Notes

- Uses Next.js App Router with React Server Components
- Database schema uses UUIDs for primary keys
- File uploads go directly to cloud storage via presigned URLs
- Subscription plans control feature access
- Build process includes TypeScript type checking
- Default language is Hebrew with RTL support
- All public client-side environment variables use NEXT_PUBLIC_ prefix

## RTL/Hebrew Language Support

The application is configured for Hebrew language by default:
- HTML `dir="rtl"` and `lang="he"` attributes set in root layout
- Rubik font with Hebrew subset for proper typography
- RTL-aware Tailwind CSS utilities
- Toaster notifications positioned for RTL layout

## Additional Information

- **authentication** - please see `docs/authentication.md` for information about how authentication is setup on this project.
- **architecture** - please see `docs/architecture.md` for information about how the code is setup in a layered architecture on this project.
- **subscriptions** - please see `docs/subscriptions.md` for learn about how user plans and subscriptions are setup.
- **ux** - please see `docs/ux.md` for user experience guidelines to make sure this app feels consistent.
- **file-uploads** - please see `docs/file-uploads.md` for more information about how file uploads work in our code base
