/**
 * Profile storage — persists user profiles as JSON on disk.
 *
 * Profiles are stored in a single JSON file alongside the server.
 * Built-in profiles (lead-free, leaded) are always available and cannot be overwritten.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Profile } from '../shared/profile.ts';
import { BUILTIN_PROFILES } from '../shared/profile.ts';
import { logger } from '../utils/logger.ts';

const PROFILES_FILE = join(import.meta.dir, '..', '..', 'profiles.json');

let userProfiles: Profile[] = [];

/** Load user profiles from disk */
export function loadProfiles(): Profile[] {
  try {
    if (existsSync(PROFILES_FILE)) {
      const raw = readFileSync(PROFILES_FILE, 'utf-8');
      userProfiles = JSON.parse(raw) as Profile[];
      logger.info(`Loaded ${userProfiles.length} user profile(s) from ${PROFILES_FILE}`);
    }
  } catch (err) {
    logger.error('Failed to load profiles:', err);
    userProfiles = [];
  }
  return userProfiles;
}

/** Save user profiles to disk */
function saveProfiles(): void {
  try {
    writeFileSync(PROFILES_FILE, JSON.stringify(userProfiles, null, 2), 'utf-8');
    logger.info(`Saved ${userProfiles.length} user profile(s) to ${PROFILES_FILE}`);
  } catch (err) {
    logger.error('Failed to save profiles:', err);
  }
}

/** Get all profiles (built-in + user) */
export function getAllProfiles(): Profile[] {
  return [...BUILTIN_PROFILES, ...userProfiles];
}

/** Get a single profile by ID */
export function getProfile(id: string): Profile | undefined {
  return BUILTIN_PROFILES.find(p => p.id === id) ?? userProfiles.find(p => p.id === id);
}

/** Save or update a user profile. Returns the saved profile. */
export function saveProfile(profile: Profile): Profile {
  // Don't allow overwriting built-in profiles
  if (BUILTIN_PROFILES.some(p => p.id === profile.id)) {
    // Clone with new ID
    profile = { ...profile, id: `user-${Date.now()}` };
  }

  profile.updatedAt = Date.now();

  const existingIndex = userProfiles.findIndex(p => p.id === profile.id);
  if (existingIndex >= 0) {
    userProfiles[existingIndex] = profile;
  } else {
    userProfiles.push(profile);
  }

  saveProfiles();
  return profile;
}

/** Delete a user profile by ID. Returns true if found and deleted. */
export function deleteProfile(id: string): boolean {
  // Can't delete built-in profiles
  if (BUILTIN_PROFILES.some(p => p.id === id)) return false;

  const index = userProfiles.findIndex(p => p.id === id);
  if (index < 0) return false;

  userProfiles.splice(index, 1);
  saveProfiles();
  return true;
}
