-- Migration: Add notification_email column to user table
-- This allows users to receive notifications at a different email than their login email

ALTER TABLE "user" ADD COLUMN "notification_email" text;
