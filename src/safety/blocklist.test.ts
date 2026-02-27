import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Blocklist } from './blocklist.js';

// Use a temp directory inside the OS temp folder to avoid polluting the repo
const TEST_DIR = path.join(process.env.TEMP ?? '/tmp', 'solsniper-test');
const TEST_FILE = path.join(TEST_DIR, 'test-blocklist.json');

describe('Blocklist', () => {
  beforeEach(() => {
    // Clean up any leftover file before each test
    if (fs.existsSync(TEST_FILE)) {
      fs.rmSync(TEST_FILE);
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (fs.existsSync(TEST_FILE)) {
      fs.rmSync(TEST_FILE);
    }
  });

  it('starts empty when file does not exist', () => {
    const blocklist = new Blocklist(TEST_FILE);
    blocklist.load();
    expect(blocklist.size).toBe(0);
  });

  it('has() returns false for addresses not in the list', () => {
    const blocklist = new Blocklist(TEST_FILE);
    blocklist.load();
    expect(blocklist.has('SomeAddress123')).toBe(false);
  });

  it('has() returns true after add()', () => {
    const blocklist = new Blocklist(TEST_FILE);
    blocklist.load();
    blocklist.add('Address1111');
    expect(blocklist.has('Address1111')).toBe(true);
  });

  it('size increases as entries are added', () => {
    const blocklist = new Blocklist(TEST_FILE);
    blocklist.load();
    expect(blocklist.size).toBe(0);
    blocklist.add('Address1111');
    expect(blocklist.size).toBe(1);
    blocklist.add('Address2222');
    expect(blocklist.size).toBe(2);
  });

  it('persists entries to disk and reloads them correctly', () => {
    const blocklist = new Blocklist(TEST_FILE);
    blocklist.load();
    blocklist.add('Address1111');
    blocklist.add('Address2222');

    // Reload from disk in a new instance
    const blocklist2 = new Blocklist(TEST_FILE);
    blocklist2.load();

    expect(blocklist2.size).toBe(2);
    expect(blocklist2.has('Address1111')).toBe(true);
    expect(blocklist2.has('Address2222')).toBe(true);
  });

  it('does not duplicate entries when same address is added twice', () => {
    const blocklist = new Blocklist(TEST_FILE);
    blocklist.load();
    blocklist.add('Address1111');
    blocklist.add('Address1111');
    expect(blocklist.size).toBe(1);

    // Reload from disk should also have size 1
    const blocklist2 = new Blocklist(TEST_FILE);
    blocklist2.load();
    expect(blocklist2.size).toBe(1);
  });

  it('creates directory if it does not exist', () => {
    const nestedDir = path.join(TEST_DIR, 'nested', 'deep');
    const nestedFile = path.join(nestedDir, 'blocklist.json');

    try {
      const blocklist = new Blocklist(nestedFile);
      blocklist.add('AddressNested');
      expect(fs.existsSync(nestedFile)).toBe(true);
    } finally {
      // Cleanup nested dirs
      if (fs.existsSync(nestedDir)) {
        fs.rmSync(path.join(TEST_DIR, 'nested'), { recursive: true });
      }
    }
  });
});
