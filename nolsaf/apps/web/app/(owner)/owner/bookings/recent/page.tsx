"use client";
import { useEffect, useState, useRef } from "react";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import io from 'socket.io-client';
import Link from "next/link";
import { Calendar, Eye, Check } from "lucide-react";
import TableRow from "@/components/TableRow";

// Use same-origin requests + secure httpOnly cookie session
const api = apiClient;

export default function RecentBookings() {
  const [list, setList] = useState<any[] | null>(null);
  const [minWaitElapsed, setMinWaitElapsed] = useState(false);
  const retryDelayRef = useRef<number>(2000);
  const pollTimerRef = useRef<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;

    const controller = new AbortController();

    const clearPoll = () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const fetchData = async () => {
      if (!mounted) return;
      try {
        const r = await api.get('/api/owner/bookings/recent', { signal: controller.signal });
        if (!mounted) return;
        setList(r.data ?? []);
        retryDelayRef.current = 2000; // reset backoff on success
        clearPoll();
        pollTimerRef.current = window.setTimeout(() => fetchData(), 12_000);
      } catch (err: any) {
        // handle network errors silently and backoff
        console.warn('could not load recent bookings (will retry in background)', err?.message ?? err);
        // exponential backoff up to 60s
        retryDelayRef.current = Math.min(retryDelayRef.current * 2, 60_000);
        clearPoll();
        pollTimerRef.current = window.setTimeout(() => fetchData(), retryDelayRef.current);
      }
    };

    // initial fetch
    fetchData();

  // minimum wait before showing empty state (5s)
  const minTimer = window.setTimeout(() => setMinWaitElapsed(true), 5000);

    // visibility: when tab becomes visible, fetch immediately
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', onVis);

    // when browser regains network connectivity, try immediately
    const onOnline = () => fetchData();
    window.addEventListener('online', onOnline);

    // socket updates from server — connect directly to API server
    // WebSocket upgrades don't work through Next.js rewrites
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 
                      process.env.NEXT_PUBLIC_API_URL || 
                      "http://localhost:4000";
    const socket = io(socketUrl, { 
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
    });
    // Join owner room for targeted realtime updates (security).
    // Best-effort; if it fails we still have polling.
    (async () => {
      try {
        const meRes = await fetchAccountSession();
        const me = meRes.data;
        const ownerId = Number(me?.id || 0);
        if (ownerId) {
          socket.emit("join-owner-room", { ownerId });
        }
      } catch {}
    })();
    socket.on('owner:bookings:updated', () => fetchData());

    return () => {
      mounted = false;
      controller.abort();
      clearPoll();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      socket.disconnect();
      window.clearTimeout(minTimer);
    };
  }, []);

  // close menu on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!(e.target instanceof Node)) return;
      if (!menuRef.current.contains(e.target)) setOpenMenuId(null);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  if (list === null && !minWaitElapsed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <span aria-hidden className="dot-spinner mb-2" aria-live="polite">
            <span className="dot dot-blue" />
            <span className="dot dot-black" />
            <span className="dot dot-yellow" />
            <span className="dot dot-green" />
          </span>
          <div className="mt-3 text-sm text-gray-600">Loading recent bookings…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] px-4 py-6 flex items-start justify-center">
      <div className="w-full max-w-2xl">
        <div className="flex justify-center">
          <Calendar className="h-8 w-8 text-blue-600" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold text-center mt-3">Recent Bookings</h1>
  {/* errors are handled silently in background retry; no persistent error UI */}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm border-collapse table-auto">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2 border-b">Booking Code</th>
                <th className="px-3 py-2 border-b">Full Name</th>
                <th className="px-3 py-2 border-b">Phone</th>
                <th className="px-3 py-2 border-b">Room Type</th>
                <th className="px-3 py-2 border-b">Check-In</th>
                <th className="px-3 py-2 border-b">Action</th>
              </tr>
            </thead>
            <tbody>
              { (list ?? []).length === 0 ? (
                <tr>
                  <td className="px-3 py-6 border-b text-center" colSpan={6}>
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Calendar className="h-12 w-12 text-slate-400" aria-hidden />
                        <div className="text-sm opacity-70">No recent bookings awaiting validation.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                  (list ?? []).map((b) => {
                  const bookingCode = b?.code?.codeVisible ?? b.codeVisible ?? b.roomCode ?? b.id;
                  const fullName = b?.guestName ?? b?.customerName ?? '-';
                  const phone = b?.guestPhone ?? b?.phone ?? '-';
                  const roomType = b?.roomType ?? '-';
                  const checkIn = b?.checkIn ? new Date(b.checkIn).toLocaleDateString() : '-';
                  return (
                    <TableRow key={b.id} className="align-top">
                      <td className="px-3 py-2 border-b">{bookingCode}</td>
                      <td className="px-3 py-2 border-b">{fullName}</td>
                      <td className="px-3 py-2 border-b">{phone}</td>
                      <td className="px-3 py-2 border-b">{roomType}</td>
                      <td className="px-3 py-2 border-b">{checkIn}</td>
                      <td className="px-3 py-2 border-b">
                        <div className="relative inline-block" ref={(el) => { if (openMenuId === b.id) menuRef.current = el; }}>
                          <button aria-haspopup="true" aria-label="Open actions" onClick={() => setOpenMenuId(openMenuId === b.id ? null : b.id)} className="p-2 rounded-md hover:bg-slate-100">
                            <Eye className="h-5 w-5" aria-hidden />
                          </button>
                          {openMenuId === b.id && (
                            <div className="absolute right-0 mt-2 w-44 bg-white border rounded-md shadow-md z-20">
                              <Link href={`/owner/bookings/validate?bookingId=${b.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 hover:text-slate-900">
                                <Check className="h-4 w-4 text-green-600" />
                                <span className="text-sm">Validate</span>
                              </Link>
                              <Link href={`/owner/bookings/checked-in/${encodeURIComponent(b.bookingReference)}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 hover:text-slate-900 no-underline">
                                <Eye className="h-4 w-4 text-slate-600" />
                                <span className="text-sm">View</span>
                              </Link>
                            </div>
                          )}
                        </div>
                      </td>
                    </TableRow>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
