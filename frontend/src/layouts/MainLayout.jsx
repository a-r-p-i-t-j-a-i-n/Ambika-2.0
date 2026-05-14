import React, { useState, useMemo } from 'react';
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider, IconButton, AppBar, Toolbar, useTheme, useMediaQuery,
  alpha, Avatar, Tooltip,
} from '@mui/material';
import {
  Menu as MenuIcon, LayoutDashboard, ShoppingCart, Truck, FileText, Package,
  Users, UserCog, LogOut, CalendarPlus, Radar, ChevronRight,
} from 'lucide-react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/slices/authSlice';

import AmbikaLogo from '../assets/ambikalogo.jpeg';

const drawerWidth = 268;

const navSections = [
  {
    title: 'Operations',
    items: [
      { text: 'Dashboard',         icon: <LayoutDashboard size={19} />, path: '/dashboard' },
      { text: 'Control Tower',     icon: <Radar size={19} />,           path: '/dispatch-control-tower' },
    ],
  },
  {
    title: 'Sales & Planning',
    items: [
      { text: 'Sales Orders',      icon: <ShoppingCart size={19} />,    path: '/orders' },
      { text: 'Dispatch Planning', icon: <CalendarPlus size={19} />,    path: '/dispatch-planning' },
      { text: 'PPC Planning',      icon: <Package size={19} />,         path: '/ppc-planning' },
    ],
  },
  {
    title: 'Execution',
    items: [
      { text: 'Actual Dispatch',   icon: <Truck size={19} />,           path: '/challans' },
      { text: 'Invoices & FMS',    icon: <FileText size={19} />,        path: '/invoices' },
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
};

const MainLayout = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);

  const sections = useMemo(() => {
    if (user?.role === 'MD') {
      return [
        ...navSections,
        {
          title: 'Administration',
          items: [{ text: 'Employees', icon: <UserCog size={19} />, path: '/employees' }],
        },
      ];
    }
    return navSections;
  }, [user]);

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

  const drawerContent = (
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
          px: 2.5,
          py: 2.25,
          display: 'flex',
          alignItems: 'center',
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
            backdropFilter: 'blur(8px)',
          }}
        >
          <img src={AmbikaLogo} alt="Ambika" style={{ width: 36, height: 36, objectFit: 'contain' }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.01em', lineHeight: 1.1, color: '#ffffff' }}>
            Ambika Dispatch
          </Typography>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.78)' }}>
            Planning &middot; Execution
          </Typography>
        </Box>
      </Box>

      {/* Sections */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', py: 1.25 }}>
        {sections.map((section) => (
          <Box key={section.title} sx={{ px: 1.75, mb: 1.5 }}>
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
            <List disablePadding>
              {section.items.map((item) => {
                const isSelected = location.pathname.startsWith(item.path);
                return (
                  <ListItem key={item.text} disablePadding sx={{ mb: 0.25 }}>
                    <ListItemButton
                      onClick={() => { navigate(item.path); if (isMobile) setMobileOpen(false); }}
                      selected={isSelected}
                      sx={{
                        position: 'relative',
                        borderRadius: 2,
                        px: 1.25,
                        py: 0.9,
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
                            left: -6,
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
                          minWidth: 34,
                          color: isSelected ? 'primary.main' : 'text.secondary',
                        }}
                      >
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.text}
                        primaryTypographyProps={{
                          fontSize: '0.875rem',
                          fontWeight: isSelected ? 700 : 500,
                          color: isSelected ? 'primary.dark' : 'text.primary',
                        }}
                      />
                      {isSelected && (
                        <ChevronRight size={15} color={theme.palette.primary.main} style={{ opacity: 0.7 }} />
                      )}
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      {/* User card + logout */}
      <Box sx={{ p: 1.75, borderTop: '1px solid', borderColor: 'divider' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            p: 1.25,
            borderRadius: 2.5,
            background: 'linear-gradient(135deg, #f5f8ff 0%, #eaf0fb 100%)',
            border: '1px solid',
            borderColor: 'divider',
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
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.2 }} noWrap>
              {user?.name || 'User'}
            </Typography>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 500, color: 'text.secondary' }} noWrap>
              {user?.role || 'Member'}
            </Typography>
          </Box>
          <Tooltip title="Sign out" arrow>
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
      </Box>
    </Box>
  );

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
          <Typography variant="h6" noWrap sx={{ fontWeight: 700, color: 'primary.dark' }}>
            {pageTitle}
          </Typography>
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
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawerContent}
        </Drawer>
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
