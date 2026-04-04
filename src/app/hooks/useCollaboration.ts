// ═══════════════════════════════════════════════════════════════
// useCollaboration — Real-Time Collaboration Hook
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useCallback } from 'react';

interface CollabUser {
  userId: string;
  userName: string;
  activeSegmentId: string | null;
}

interface SegmentLock {
  segmentId: string;
  lockedBy: { userId: string; userName: string };
}

interface UseCollaborationOptions {
  projectId: string;
  userId: string;
  userName: string;
  onSegmentStatusChange: (segmentId: string, status: string) => void;
  onSegmentTextChange: (segmentId: string, newTarget: string) => void;
}

export function useCollaboration({
  projectId,
  userId,
  userName,
  onSegmentStatusChange,
  onSegmentTextChange,
}: UseCollaborationOptions) {
  const socketRef = useRef<any>(null);
  const [connectedUsers, setConnectedUsers] = useState<CollabUser[]>([]);
  const [segmentLocks, setSegmentLocks] = useState<Map<string, SegmentLock>>(new Map());
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!projectId) return;

    let socket: any = null;

    // Dynamic import to avoid breaking if socket.io-client is not installed
    import('socket.io-client').then(({ io }) => {
      socket = io('http://localhost:3001', {
        transports: ['websocket'],
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setIsConnected(true);
        socket.emit('join_project', { projectId, userId, userName });
      });

      socket.on('disconnect', () => setIsConnected(false));

      socket.on('presence_update', ({ users }: { users: CollabUser[] }) => {
        setConnectedUsers(users.filter((u: CollabUser) => u.userId !== userId));
      });

      socket.on('user_joined', (user: CollabUser) => {
        setConnectedUsers(prev => [...prev.filter(u => u.userId !== user.userId), user]);
      });

      socket.on('user_left', ({ userId: leftId }: { userId: string }) => {
        setConnectedUsers(prev => prev.filter(u => u.userId !== leftId));
      });

      socket.on('segment_locked', (lock: SegmentLock) => {
        if (lock.lockedBy.userId !== userId) {
          setSegmentLocks(prev => new Map(prev).set(lock.segmentId, lock));
        }
      });

      socket.on('segment_unlocked', ({ segmentId }: { segmentId: string }) => {
        setSegmentLocks(prev => {
          const next = new Map(prev);
          next.delete(segmentId);
          return next;
        });
      });

      socket.on('segment_status_changed', ({ segmentId, status }: { segmentId: string; status: string }) => {
        onSegmentStatusChange(segmentId, status);
      });

      socket.on('segment_text_changed', ({ segmentId, newTarget }: { segmentId: string; newTarget: string }) => {
        onSegmentTextChange(segmentId, newTarget);
      });
    }).catch(() => {
      // socket.io-client not installed — collaboration disabled
      console.warn('[Collab] socket.io-client not available. Real-time collaboration disabled.');
    });

    return () => {
      if (socket) {
        socket.emit('leave_project', { projectId, userId });
        socket.disconnect();
      }
    };
  }, [projectId, userId]);

  const focusSegment = useCallback((segmentId: string) => {
    socketRef.current?.emit('segment_focus', { projectId, segmentId, userId, userName });
  }, [projectId, userId, userName]);

  const blurSegment = useCallback((segmentId: string) => {
    socketRef.current?.emit('segment_blur', { projectId, segmentId, userId });
  }, [projectId, userId]);

  const broadcastTextChange = useCallback((segmentId: string, newTarget: string) => {
    socketRef.current?.emit('segment_updated', { projectId, segmentId, newTarget, userId });
  }, [projectId, userId]);

  const broadcastApproval = useCallback((segmentId: string) => {
    socketRef.current?.emit('segment_approved', { projectId, segmentId, userId });
  }, [projectId, userId]);

  const broadcastRejection = useCallback((segmentId: string) => {
    socketRef.current?.emit('segment_rejected', { projectId, segmentId, userId });
  }, [projectId, userId]);

  const isLockedByOther = useCallback((segmentId: string): { locked: boolean; lockedBy?: { userId: string; userName: string } } => {
    const lock = segmentLocks.get(segmentId);
    return lock ? { locked: true, lockedBy: lock.lockedBy } : { locked: false };
  }, [segmentLocks]);

  return {
    isConnected,
    connectedUsers,
    focusSegment,
    blurSegment,
    broadcastTextChange,
    broadcastApproval,
    broadcastRejection,
    isLockedByOther,
  };
}
