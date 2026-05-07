import React, { useState } from 'react';
import { Box, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography, Divider, IconButton, AppBar, Toolbar, useTheme, useMediaQuery, alpha } from '@mui/material';
import { Menu as MenuIcon, LayoutDashboard, ShoppingCart, Truck, FileText, Package, Users, Settings, LogOut } from 'lucide-react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { logout } from '../store/slices/authSlice';

// Branding Assets
import AmbikaLogo from '../assets/ambikalogo.jpeg';
import AmbikaFullLogo from '../assets/ambikacompletelogowithimage.jpeg';

const drawerWidth = 260;

const menuItems = [
  { text: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/dashboard' },
  { text: 'Sales Orders', icon: <ShoppingCart size={20} />, path: '/orders' },
  { text: 'PPC Planning', icon: <Package size={20} />, path: '/ppc-planning' },
  { text: 'Delivery Challans', icon: <Truck size={20} />, path: '/challans' },
  { text: 'Invoices & FMS', icon: <FileText size={20} />, path: '/invoices' },
  { divider: true },
  { text: 'SKU Master', icon: <Package size={20} />, path: '/skus' },
  { text: 'Parties', icon: <Users size={20} />, path: '/parties' },
];

const MainLayout = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  const drawerContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <img 
          src={AmbikaFullLogo} 
          alt="Ambika Logo" 
          style={{ width: '100%', height: 'auto', maxHeight: 80, objectFit: 'contain' }} 
        />
        <Divider sx={{ width: '100%', mt: 1 }} />
      </Box>
      
      <List sx={{ px: 2, flexGrow: 1 }}>
        {menuItems.map((item, index) => {
          if (item.divider) return <Divider key={`div-${index}`} sx={{ my: 2 }} />;
          
          const isSelected = location.pathname.startsWith(item.path);
          
          return (
            <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                selected={isSelected}
                onClick={() => navigate(item.path)}
                sx={{
                  borderRadius: 2,
                  '&.Mui-selected': {
                    bgcolor: 'primary.main',
                    color: 'white',
                    '&:hover': { bgcolor: 'primary.dark' },
                    '& .MuiListItemIcon-root': { color: 'white' },
                  },
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                  }
                }}
              >
                <ListItemIcon sx={{ minWidth: 40, color: isSelected ? 'white' : 'primary.main' }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText 
                  primary={item.text} 
                  primaryTypographyProps={{ 
                    fontWeight: isSelected ? 700 : 500,
                    fontSize: '0.9rem'
                  }} 
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      <Box sx={{ p: 2 }}>
        <ListItem disablePadding>
          <ListItemButton onClick={handleLogout} sx={{ borderRadius: 2, color: 'error.main' }}>
            <ListItemIcon sx={{ minWidth: 40, color: 'error.main' }}>
              <LogOut size={20} />
            </ListItemIcon>
            <ListItemText primary="Logout" primaryTypographyProps={{ fontWeight: 600 }} />
          </ListItemButton>
        </ListItem>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* App Bar (Mobile Only) */}
      <AppBar position="fixed" sx={{ width: { sm: `calc(100% - ${drawerWidth}px)` }, ml: { sm: `${drawerWidth}px` }, display: { sm: 'none' }, bgcolor: 'background.paper', color: 'primary.main', boxShadow: 1 }}>
        <Toolbar>
          <IconButton color="inherit" edge="start" onClick={handleDrawerToggle} sx={{ mr: 2 }}>
            <MenuIcon />
          </IconButton>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <img src={AmbikaLogo} alt="Logo" style={{ height: 32 }} />
            <Typography variant="h6" noWrap component="div" fontWeight={700}>
              Ambika Dispatch
            </Typography>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', sm: 'none' }, '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth, borderRight: 'none', boxShadow: 4 } }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{ display: { xs: 'none', sm: 'block' }, '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth, borderRight: '1px solid', borderColor: 'divider', boxShadow: 'none' } }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      {/* Main Content */}
      <Box component="main" sx={{ 
        flexGrow: 1, 
        p: { xs: 0, sm: 0 }, 
        width: { sm: `calc(100% - ${drawerWidth}px)` }, 
        mt: { xs: 7, sm: 0 }, // Reduced from 8 to 7 for a tighter fit
        minWidth: 0, // Important for flex items to not overflow
      }}>
        <Outlet />
      </Box>
    </Box>
  );
};

export default MainLayout;