// ═══════════════════════════════════════════════════════════════
// Collaboration Manager — In-Memory State for Real-Time Editing
// ═══════════════════════════════════════════════════════════════
//
// Manages per-project rooms, user presence, and segment locks.
// For multi-server deployments, this should move to Redis pub/sub.
//
// ═══════════════════════════════════════════════════════════════

const projectRooms = new Map();
// Map<projectId, {
//   users: Map<userId, {userName, socketId, activeSegmentId}>,
//   locks: Map<segmentId, userId>
// }>

export function getOrCreateRoom(projectId) {
  if (!projectRooms.has(projectId)) {
    projectRooms.set(projectId, {
      users: new Map(),
      locks: new Map(),
    });
  }
  return projectRooms.get(projectId);
}

export function joinRoom(projectId, userId, userName, socketId) {
  const room = getOrCreateRoom(projectId);
  room.users.set(userId, { userName, socketId, activeSegmentId: null });
  return getPresenceSnapshot(projectId);
}

export function leaveRoom(projectId, userId) {
  const room = projectRooms.get(projectId);
  if (!room) return { releasedSegments: [] };

  // Release all segment locks held by this user
  const releasedSegments = [];
  for (const [segmentId, lockHolder] of room.locks.entries()) {
    if (lockHolder === userId) {
      room.locks.delete(segmentId);
      releasedSegments.push(segmentId);
    }
  }

  room.users.delete(userId);
  if (room.users.size === 0) projectRooms.delete(projectId);

  return { releasedSegments };
}

export function lockSegment(projectId, segmentId, userId) {
  const room = getOrCreateRoom(projectId);
  const existingLock = room.locks.get(segmentId);
  if (existingLock && existingLock !== userId) {
    return { success: false, lockedBy: existingLock };
  }
  room.locks.set(segmentId, userId);
  const user = room.users.get(userId);
  if (user) user.activeSegmentId = segmentId;
  return { success: true };
}

export function unlockSegment(projectId, segmentId, userId) {
  const room = getOrCreateRoom(projectId);
  const existingLock = room.locks.get(segmentId);
  if (existingLock === userId) {
    room.locks.delete(segmentId);
    const user = room.users.get(userId);
    if (user) user.activeSegmentId = null;
  }
}

export function getPresenceSnapshot(projectId) {
  const room = projectRooms.get(projectId);
  if (!room) return [];
  return Array.from(room.users.entries()).map(([userId, data]) => ({
    userId,
    userName: data.userName,
    activeSegmentId: data.activeSegmentId,
  }));
}

export function isSegmentLocked(projectId, segmentId, requestingUserId) {
  const room = projectRooms.get(projectId);
  if (!room) return false;
  const lockHolder = room.locks.get(segmentId);
  return lockHolder && lockHolder !== requestingUserId;
}
