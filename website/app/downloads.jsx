"use client";
import { useEffect } from 'react';
import { initDownloads } from '../src/js/site.js';
export default function Downloads() { useEffect(() => { initDownloads(); }, []); return null; }
