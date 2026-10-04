"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSocket } from "@/hooks/useSocket";

type AdminNotification = {
  id?: string | number;
  title?: string;
  body?: string;
  type?: string;
  template?: string;
  priority?: "normal" | "urgent";
  createdAt?: string;
};

const SOUND_COOLDOWN_MS = 1_200;
const SOUND_KEY = "nolsaf:admin-notification-sound";

export default function AdminNotificationListener() {
  const { socket } = useSocket(undefined, { enabled: true, joinDriverRoom: false });
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const lastSoundAtRef = useRef(0);
  const soundEnabledRef = useRef(true);

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;

    try {
      const AudioContextClass = window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      void context.resume().then(() => {
        audioUnlockedRef.current = context.state === "running";
      }).catch(() => undefined);
    } catch {
      // Audio is an enhancement; notifications still arrive visually.
    }
  }, []);

  const playChime = useCallback((urgent: boolean) => {
    const now = Date.now();
    if (!audioUnlockedRef.current || now - lastSoundAtRef.current < SOUND_COOLDOWN_MS) return;

    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;
    lastSoundAtRef.current = now;

    const start = context.currentTime;
    const notes = urgent
      ? [{ frequency: 740, offset: 0 }, { frequency: 988, offset: 0.16 }]
      : [{ frequency: 660, offset: 0 }, { frequency: 880, offset: 0.12 }];

    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = start + note.offset;
      const noteEnd = noteStart + (urgent ? 0.22 : 0.16);

      oscillator.type = urgent ? "square" : "sine";
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(urgent ? 0.09 : 0.055, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd);
    }
  }, []);

  useEffect(() => {
    soundEnabledRef.current = localStorage.getItem(SOUND_KEY) !== "off";
    const onSoundChange = (event: Event) => {
      soundEnabledRef.current = (event as CustomEvent<{ enabled?: boolean }>).detail?.enabled !== false;
    };
    window.addEventListener("nols:admin-notification-sound-change", onSoundChange);
    const armAudio = () => unlockAudio();
    window.addEventListener("pointerdown", armAudio, { once: true, passive: true });
    window.addEventListener("keydown", armAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", armAudio);
      window.removeEventListener("keydown", armAudio);
      window.removeEventListener("nols:admin-notification-sound-change", onSoundChange);
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [unlockAudio]);

  useEffect(() => {
    if (!socket) return;

    const joinAdminRoom = () => socket.emit("join-admin-room");
    const onNotification = (notification: AdminNotification) => {
      const urgent = notification?.priority === "urgent";

      window.dispatchEvent(new CustomEvent("nols:toast", {
        detail: {
          type: urgent ? "error" : "info",
          title: notification?.title || "New admin notification",
          message: notification?.body,
          duration: urgent ? 8_000 : 5_000,
        },
      }));
      window.dispatchEvent(new CustomEvent("nols:admin-notification", { detail: notification }));
      if (soundEnabledRef.current) playChime(urgent);
    };

    // A visitor handed to support, or writing again in a support chat. The toast
    // and chime come from admin:notification:new; this only tells the Twiga
    // page and the sidebar badge to refresh.
    const onTwigaActivity = (activity: { kind?: string; conversationId?: number }) => {
      window.dispatchEvent(new CustomEvent("nols:twiga-activity", { detail: activity }));
    };

    if (socket.connected) joinAdminRoom();
    socket.on("connect", joinAdminRoom);
    socket.on("admin:notification:new", onNotification);
    socket.on("chatbot:activity", onTwigaActivity);

    return () => {
      socket.off("connect", joinAdminRoom);
      socket.off("admin:notification:new", onNotification);
      socket.off("chatbot:activity", onTwigaActivity);
      if (socket.connected) socket.emit("leave-admin-room");
    };
  }, [playChime, socket]);

  return null;
}
