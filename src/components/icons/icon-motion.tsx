"use client";

import { useEffect } from "react";

import { listenForIconClicks } from "./motion";

/**
 * Plays an icon's click animation (motion.css) when the button or link it
 * sits in is clicked, anywhere in the app. Renders nothing; mount it once.
 */
export function IconMotion() {
  useEffect(() => listenForIconClicks(), []);
  return null;
}
