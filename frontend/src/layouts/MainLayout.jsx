import React, { useState, useMemo } from 'react';
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Typography, IconButton, AppBar, Toolbar, useTheme, useMediaQuery,
  alpha, Avatar, Tooltip, Collapse,
} from '@mui/material';
import {
  Menu as MenuIcon, LayoutDashboard, ShoppingCart, Truck, FileText, Package,
  Users, UserCog, LogOut, CalendarPlus, Radar, ChevronRight, ChevronLeft, ChevronDown, ShieldCheck,
  IndianRupee, Calculator, FileSignature, ClipboardCheck, FolderOpen, BarChart3, Tag,
  Workflow, ListChecks, Gauge, SlidersHorizontal, ClipboardList, Trophy,
} from 'lucide-react';
import { Badge } from '@mui/material';
import { useGetPendingRevisionsQuery } from '../store/api/pricingApi';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/slices/authSlice';
import { usePermissions } from '../hooks/usePermission';

import AmbikaLogo from '../assets/ambikalogo.jpeg';
import NotificationBell from '../features/notifications/NotificationBell';

const EXPANDED_WIDTH = 268;
const COLLAPSED_WIDTH = 76;

const navSections = [
  {
    title: 'Operations',
    items: [
      { text: 'Dashboard',         icon: <LayoutDashboard size={19} />, path: '/dashboard' },
      { text: 'Control Tower',     icon: <Radar size={19} />,           path: '/dispatch-control-tower' },
    ],
  },
  {
    title: 'Order to Dispatch',
    items: [
      {
        text: 'O2D Pipeline',
        icon: <Workflow size={19} />,
        path: '/orders',
        children: [
          { text: 'Sales Orders',      icon: <ShoppingCart size={19} />, path: '/orders' },
          { text: 'Dispatch Planning', icon: <CalendarPlus size={19} />, path: '/dispatch-planning' },
          { text: 'Actual Dispatch',   icon: <Truck size={19} />,        path: '/challans' },
        ],
      },
      { text: 'PPC Planning',   icon: <Package size={19} />,  path: '/ppc-planning' },
      { text: 'Invoices & FMS', icon: <FileText size={19} />, path: '/invoices' },
    ],
  },
  {
    title: 'Master Data',
    items: [
      { text: 'SKU Master',        icon: <Package size={19} />,         path: '/skus' },
      { text: 'Parties',           icon: <Users size={19} />,           path: '/parties' },
    ],
  },
];

const PAGE_TITLES = {
  '/dashboard':              'Dispatch Intelligence Hub',
  '/dispatch-control-tower': 'Control Tower',
  '/orders':                 'Sales Orders',
  '/dispatch-planning':      'Dispatch Planning',
  '/ppc-planning':           'PPC Planning',
  '/challans':               'Actual Dispatch',
  '/invoices':               'Invoices & FMS',
  '/skus':                   'SKU Master',
  '/parties':                'Party Master',
  '/employees':              'Employees',
  '/access-control':         'Access Control',
  '/pricing':                'Pricing Hub',
  '/pricing/approvals':      'Approval Inbox',
  '/pricing/calculator':     'Turnover Calculator',
  '/pricing/documents':      'Pricing Documents',
  '/pricing/analytics':      'Pricing Analytics',
  '/quotes':                 'Quotes',
  '/o2d-fms':                'O2D FMS — My Tasks',
  '/o2d-fms/processes':      'O2D FMS — Processes',
  '/o2d-fms/dashboard':      'O2D FMS — Management View',
  '/o2d-fms/config':         'O2D FMS — Step Catalog',
  '/profile':                'My Profile',
};

const MainLayout = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Tracks which expandable nav groups (e.g. Pricing Hub) the user has
  // toggled. `undefined` for a group falls back to auto-open when the active
  // route lives inside it.
  const [openMenus, setOpenMenus] = useState({});
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user, isAuthenticated } = useSelector((state) => state.auth);
  const { can, canAny, isRoot } = usePermissions();

  const drawerWidth = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  // Live badge for the Approval Inbox sidebar entry.
  const { data: pendingRes } = useGetPendingRevisionsQuery(undefined, {
    skip: !isAuthenticated || (!can('pricing.approve') && !isRoot),
    pollingInterval: 60_000,
  });
  const pendingCount = pendingRes?.data?.length || 0;

  const sections = useMemo(() => {
    const out = [...navSections];

    // Pricing & Revenue
    const pricingItems = [];
    if (can('pricing.view') || isRoot) {
      pricingItems.push({
        text: 'Pricing Hub',
        icon: <IndianRupee size={19} />,
        path: '/pricing',
        children: [
          { text: 'Selling Price', icon: <Tag size={17} />,          path: '/pricing',                 stream: 'SELLING' },
          { text: 'RM Cost',       icon: <ShoppingCart size={17} />, path: '/pricing?stream=RM_COST',  stream: 'RM_COST' },
        ],
      });
    }
    if (can('pricing.approve') || isRoot) {
      pricingItems.push({
        text: 'Approval Inbox',
        icon: (
          <Badge color="warning" variant={pendingCount > 0 ? 'standard' : 'dot'} badgeContent={pendingCount} invisible={pendingCount === 0} overlap="circular">
            <ClipboardCheck size={19} />
          </Badge>
        ),
        path: '/pricing/approvals',
      });
    }
    if (can('pricing.view') || isRoot) {
      pricingItems.push({ text: 'Turnover Calculator', icon: <Calculator size={19} />, path: '/pricing/calculator' });
    }
    if (can('pricing.view') || isRoot) {
      pricingItems.push({ text: 'Documents', icon: <FolderOpen size={19} />, path: '/pricing/documents' });
    }
    if (can('pricing.view') || isRoot) {
      pricingItems.push({ text: 'Analytics', icon: <BarChart3 size={19} />, path: '/pricing/analytics' });
    }
    if (can('quotes.view') || isRoot) {
      pricingItems.push({ text: 'Quotes', icon: <FileSignature size={19} />, path: '/quotes' });
    }
    if (pricingItems.length > 0) {
      out.push({ title: 'Pricing & Revenue', items: pricingItems });
    }

    // O2D FMS — Flow Management System (collapsible group)
    const fmsChildren = [];
    if (can('o2dfms.view') || isRoot) {
      fmsChildren.push({ text: 'My Tasks',     icon: <ListChecks size={19} />,        path: '/o2d-fms' });
      fmsChildren.push({ text: 'FMS Tracker',  icon: <Workflow size={19} />,          path: '/o2d-fms/processes' });
      fmsChildren.push({ text: 'Dashboard',    icon: <Gauge size={19} />,             path: '/o2d-fms/dashboard' });
      fmsChildren.push({ text: 'Scoreboard',   icon: <Trophy size={19} />,            path: '/o2d-fms/scores' });
    }
    if (can('o2dfms.config') || isRoot) {
      fmsChildren.push({ text: 'Step Builder',   icon: <SlidersHorizontal size={19} />, path: '/o2d-fms/config' });
      fmsChildren.push({ text: 'Task Templates', icon: <ClipboardList size={19} />,     path: '/o2d-fms/templates' });
    }
    if (fmsChildren.length > 0) {
      out.push({
        title: 'Process',
        items: [{ text: 'O2D FMS', icon: <Gauge size={19} />, path: '/o2d-fms', children: fmsChildren }],
      });
    }

    // Administration
    const adminItems = [];
    if (canAny('accessControl.manageUsers', 'accessControl.manageRoles', 'accessControl.viewAuditLog') || isRoot) {
      adminItems.push({ text: 'Access Control', icon: <ShieldCheck size={19} />, path: '/access-control' });
    }
    if (user?.role === 'MD' || isRoot) {
      adminItems.push({ text: 'Employees', icon: <UserCog size={19} />, path: '/employees' });
    }
    if (adminItems.length > 0) {
      out.push({ title: 'Administration', items: adminItems });
    }

    return out;
  }, [user, can, canAny, isRoot, pendingCount]);

  const handleDrawerToggle = () => setMobileOpen((v) => !v);
  const handleLogout = () => { dispatch(logout()); navigate('/login'); };

  const initials = (user?.name || user?.email || 'U')
    .split(' ')
    .filter(Boolean)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const pageTitle = useMemo(() => {
    const key = Object.keys(PAGE_TITLES).find((p) => location.pathname.startsWith(p));
    return key ? PAGE_TITLES[key] : 'Ambika Dispatch';
  }, [location.pathname]);

  // A group is open if the user toggled it; otherwise it auto-opens whenever
  // the active route lives under one of its children.
  const isMenuOpen = (item) =>
    openMenus[item.text] ??
    item.children?.some((c) => location.pathname === c.path.split('?')[0]);

  // `mini` collapses the sidebar to icons only. The temporary (mobile)
  // drawer always renders the full version, so it is passed mini=false.
  const renderDrawerContent = (mini) => {
    // Renders a single navigable row. `indent` is used for sub-items inside
    // an expandable group so they sit visually under their parent.
    const leafButton = (item, isSelected, { indent = false, onClick } = {}) => (
      <ListItemButton
        onClick={onClick || (() => { navigate(item.path); if (isMobile) setMobileOpen(false); })}
        selected={isSelected}
        sx={{
          position: 'relative',
          borderRadius: 2,
          px: mini ? 0 : 1.25,
          pl: !mini && indent ? 3.5 : (mini ? 0 : 1.25),
          py: indent ? 0.7 : 0.9,
          justifyContent: mini ? 'center' : 'flex-start',
          color: 'text.primary',
          '&.Mui-selected': {
            background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.10)} 0%, ${alpha(theme.palette.primary.main, 0.04)} 100%)`,
            color: 'primary.dark',
            '& .MuiListItemIcon-root': { color: 'primary.main' },
            '& .MuiListItemText-primary': { color: 'primary.dark', fontWeight: 700 },
            '&:hover': {
              background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.14)} 0%, ${alpha(theme.palette.primary.main, 0.06)} 100%)`,
            },
            '&::before': {
              content: '""',
              position: 'absolute',
              left: mini ? 0 : -6,
              top: '20%',
              bottom: '20%',
              width: 3,
              borderRadius: 4,
              background: 'linear-gradient(180deg, #3b82f6 0%, #1e3a8a 100%)',
            },
          },
        }}
      >
        <ListItemIcon
          sx={{
            minWidth: mini ? 0 : (indent ? 30 : 34),
            justifyContent: 'center',
            color: isSelected ? 'primary.main' : 'text.secondary',
          }}
        >
          {item.icon}
        </ListItemIcon>
        {!mini && (
          <ListItemText
            primary={item.text}
            primaryTypographyProps={{
              fontSize: indent ? '0.83rem' : '0.875rem',
              fontWeight: isSelected ? 700 : 500,
              color: isSelected ? 'primary.dark' : 'text.primary',
            }}
          />
        )}
        {!mini && isSelected && !indent && (
          <ChevronRight size={15} color={theme.palette.primary.main} style={{ opacity: 0.7 }} />
        )}
      </ListItemButton>
    );

    return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #ffffff 0%, #f5f8ff 100%)',
      }}
    >
      {/* Brand header */}
      <Box
        sx={{
          px: mini ? 1 : 2.5,
          py: 2.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: mini ? 'center' : 'flex-start',
          gap: 1.5,
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)',
          color: '#ffffff',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.14)',
            border: '1px solid rgba(255,255,255,0.22)',
            flexShrink: 0,
          }}
        >
          <img src={AmbikaLogo} alt="Ambika" style={{ width: 36, height: 36, objectFit: 'contain' }} />
        </Box>
        {!mini && (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.01em', lineHeight: 1.1, color: '#ffffff' }}>
              Ambika Dispatch
            </Typography>
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.78)' }}>
              Planning &middot; Execution
            </Typography>
          </Box>
        )}
      </Box>

      {/* Sections */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', py: 1.25 }}>
        {sections.map((section) => (
          <Box key={section.title} sx={{ px: mini ? 1 : 1.75, mb: 1.5 }}>
            {mini ? (
              <Box sx={{ height: 1, bgcolor: 'divider', mx: 1, mb: 1, opacity: 0.7 }} />
            ) : (
              <Typography
                sx={{
                  px: 1.25,
                  py: 0.75,
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'text.secondary',
                }}
              >
                {section.title}
              </Typography>
            )}
            <List disablePadding>
              {section.items.map((item) => {
                // ── Expandable group (e.g. Pricing Hub → Selling / RM Cost) ──
                if (item.children) {
                  const groupActive = location.pathname === item.path;

                  // Collapsed rail: no room for a dropdown — the parent icon
                  // jumps straight to its first child.
                  if (mini) {
                    return (
                      <ListItem key={item.text} disablePadding sx={{ mb: 0.25 }}>
                        <Tooltip title={item.text} placement="right" arrow>
                          <Box sx={{ width: '100%' }}>
                            {leafButton(item, groupActive, {
                              onClick: () => { navigate(item.children[0].path); if (isMobile) setMobileOpen(false); },
                            })}
                          </Box>
                        </Tooltip>
                      </ListItem>
                    );
                  }

                  const open = isMenuOpen(item);
                  const stream = new URLSearchParams(location.search).get('stream');
                  return (
                    <React.Fragment key={item.text}>
                      <ListItem disablePadding sx={{ mb: 0.25 }}>
                        <ListItemButton
                          onClick={() => setOpenMenus((m) => ({ ...m, [item.text]: !open }))}
                          sx={{
                            borderRadius: 2, px: 1.25, py: 0.9,
                            color: groupActive ? 'primary.dark' : 'text.primary',
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 34, justifyContent: 'center', color: groupActive ? 'primary.main' : 'text.secondary' }}>
                            {item.icon}
                          </ListItemIcon>
                          <ListItemText
                            primary={item.text}
                            primaryTypographyProps={{
                              fontSize: '0.875rem',
                              fontWeight: groupActive ? 700 : 500,
                              color: groupActive ? 'primary.dark' : 'text.primary',
                            }}
                          />
                          {open
                            ? <ChevronDown size={15} color={theme.palette.text.secondary} />
                            : <ChevronRight size={15} color={theme.palette.text.secondary} />}
                        </ListItemButton>
                      </ListItem>
                      <Collapse in={open} timeout="auto" unmountOnExit>
                        <List disablePadding>
                          {item.children.map((child) => {
                            // Pricing children share /pricing and disambiguate via the
                            // `stream` query param; all other children match by path.
                            const childPath = child.path.split('?')[0];
                            const childSelected = child.stream
                              ? (location.pathname === item.path &&
                                 (child.stream === 'RM_COST' ? stream === 'RM_COST' : stream !== 'RM_COST'))
                              : location.pathname === childPath;
                            return (
                              <ListItem key={child.text} disablePadding sx={{ mb: 0.25 }}>
                                {leafButton(child, childSelected, { indent: true })}
                              </ListItem>
                            );
                          })}
                        </List>
                      </Collapse>
                    </React.Fragment>
                  );
                }

                // ── Plain leaf item ──
                const isSelected = location.pathname.startsWith(item.path);
                return (
                  <ListItem key={item.text} disablePadding sx={{ mb: 0.25 }}>
                    {mini ? (
                      <Tooltip title={item.text} placement="right" arrow>
                        <Box sx={{ width: '100%' }}>{leafButton(item, isSelected)}</Box>
                      </Tooltip>
                    ) : leafButton(item, isSelected)}
                  </ListItem>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      {/* User card + logout */}
      <Box sx={{ p: mini ? 1 : 1.75, borderTop: '1px solid', borderColor: 'divider' }}>
        {mini ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <Tooltip title={`${user?.name || 'Profile'} — view profile`} placement="right" arrow>
              <Avatar
                onClick={() => { navigate('/profile'); if (isMobile) setMobileOpen(false); }}
                sx={{
                  width: 38, height: 38, cursor: 'pointer',
                  background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
                  color: '#ffffff', fontWeight: 700, fontSize: '0.85rem',
                }}
              >
                {initials}
              </Avatar>
            </Tooltip>
            <Tooltip title="Sign out" placement="right" arrow>
              <IconButton
                size="small"
                onClick={handleLogout}
                sx={{
                  color: 'error.main',
                  bgcolor: alpha(theme.palette.error.main, 0.08),
                  '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.16), color: 'error.dark' },
                }}
              >
                <LogOut size={16} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              p: 0.5,
              pl: 1.25,
              borderRadius: 2.5,
              background: 'linear-gradient(135deg, #f5f8ff 0%, #eaf0fb 100%)',
              border: '1px solid',
              borderColor: 'divider',
              transition: 'all 0.18s ease',
              '&:hover': {
                borderColor: alpha(theme.palette.primary.main, 0.4),
                boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.12)}`,
              },
            }}
          >
            <Tooltip title="View my profile" arrow placement="top">
              <Box
                role="button"
                tabIndex={0}
                onClick={() => { navigate('/profile'); if (isMobile) setMobileOpen(false); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate('/profile');
                    if (isMobile) setMobileOpen(false);
                  }
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  py: 0.75,
                  flexGrow: 1,
                  minWidth: 0,
                  cursor: 'pointer',
                  borderRadius: 2,
                  outline: 'none',
                  '&:focus-visible': {
                    boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.35)}`,
                  },
                  '&:hover .user-name': { color: 'primary.dark' },
                }}
              >
                <Avatar
                  sx={{
                    width: 38, height: 38,
                    background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
                    color: '#ffffff', fontWeight: 700, fontSize: '0.85rem',
                  }}
                >
                  {initials}
                </Avatar>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography
                    className="user-name"
                    sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.2, transition: 'color 0.15s' }}
                    noWrap
                  >
                    {user?.name || 'Loading…'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 500, color: 'text.secondary' }} noWrap>
                    {user?.role || 'Member'}
                  </Typography>
                </Box>
              </Box>
            </Tooltip>

            <NotificationBell />

            <Tooltip title="Sign out" arrow>
              <IconButton
                size="small"
                onClick={handleLogout}
                sx={{
                  mr: 0.5,
                  color: 'error.main',
                  bgcolor: alpha(theme.palette.error.main, 0.08),
                  '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.16), color: 'error.dark' },
                }}
              >
                <LogOut size={16} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Mobile top bar */}
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          display: { sm: 'none' },
          backgroundColor: 'background.paper',
          color: 'text.primary',
          backgroundImage: 'none',
          boxShadow: 'none',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ minHeight: 56 }}>
          <IconButton edge="start" onClick={handleDrawerToggle} sx={{ mr: 1.5, color: 'primary.main' }}>
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ fontWeight: 700, color: 'primary.dark', flexGrow: 1 }}>
            {pageTitle}
          </Typography>
          <NotificationBell />
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: EXPANDED_WIDTH },
          }}
        >
          {renderDrawerContent(false)}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              overflowX: 'hidden',
              transition: theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.shorter,
              }),
            },
          }}
        >
          {renderDrawerContent(collapsed)}
        </Drawer>

        {/* Collapse / expand toggle — sits on the sidebar's edge (desktop only) */}
        <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right" arrow>
          <IconButton
            onClick={() => setCollapsed((v) => !v)}
            size="small"
            sx={{
              display: { xs: 'none', sm: 'flex' },
              position: 'fixed',
              top: 70,
              left: drawerWidth - 13,
              zIndex: (t) => t.zIndex.drawer + 2,
              width: 26,
              height: 26,
              bgcolor: '#ffffff',
              color: 'primary.main',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.18)',
              transition: theme.transitions.create('left', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.shorter,
              }),
              '&:hover': { bgcolor: '#ffffff', color: 'primary.dark', borderColor: 'primary.main' },
            }}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Main content area */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          mt: { xs: 7, sm: 0 },
          minWidth: 0,
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
};

export default MainLayout;
