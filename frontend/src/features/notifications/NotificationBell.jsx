import React, { useState } from 'react';
import {
  IconButton, Badge, Popover, Box, Stack, Typography, Button, Divider, alpha,
} from '@mui/material';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useGetUnreadCountQuery, useGetNotificationsQuery,
  useMarkNotificationReadMutation, useMarkAllNotificationsReadMutation,
} from '../../store/api/notificationApi';

const timeAgo = (d) => {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString('en-IN');
};

const NotificationBell = () => {
  const [anchor, setAnchor] = useState(null);
  const navigate = useNavigate();
  const { data: countRes } = useGetUnreadCountQuery(undefined, { pollingInterval: 60_000 });
  const { data: listRes } = useGetNotificationsQuery(undefined, { skip: !anchor });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAll] = useMarkAllNotificationsReadMutation();

  const count = countRes?.data?.count || 0;
  const items = listRes?.data || [];

  const open = (n) => {
    if (!n.read) markRead(n._id);
    if (n.link) navigate(n.link);
    setAnchor(null);
  };

  return (
    <>
      <IconButton onClick={(e) => setAnchor(e.currentTarget)} sx={{ color: 'text.secondary' }}>
        <Badge badgeContent={count} color="error" max={99}><Bell size={20} /></Badge>
      </IconButton>
      <Popover
        open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 360, maxHeight: 460, borderRadius: 2 } } }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.5 }}>
          <Typography sx={{ fontWeight: 700 }}>Notifications</Typography>
          {count > 0 && (
            <Button size="small" startIcon={<CheckCheck size={14} />} onClick={() => markAll()}>Mark all read</Button>
          )}
        </Stack>
        <Divider />
        {items.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
            <Bell size={28} style={{ opacity: 0.4 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>You're all caught up</Typography>
          </Box>
        ) : (
          <Box sx={{ overflowY: 'auto' }}>
            {items.map((n) => (
              <Box key={n._id} onClick={() => open(n)}
                sx={{
                  px: 2, py: 1.25, cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider',
                  bgcolor: n.read ? 'transparent' : alpha('#1d4ed8', 0.05),
                  '&:hover': { bgcolor: alpha('#1d4ed8', 0.08) },
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: n.read ? 500 : 700 }}>{n.title}</Typography>
                {n.body && <Typography variant="caption" color="text.secondary" display="block">{n.body}</Typography>}
                <Typography variant="caption" color="text.disabled">{timeAgo(n.createdAt)}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Popover>
    </>
  );
};

export default NotificationBell;
