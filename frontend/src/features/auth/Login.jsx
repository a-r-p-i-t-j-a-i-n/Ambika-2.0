import React, { useState } from 'react';
import {
  Box, Button, TextField, Typography, Paper, CircularProgress, InputAdornment,
  IconButton, Stack, Chip,
} from '@mui/material';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Truck, BarChart3, ArrowRight } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useLoginMutation } from '../../store/api/authApi';
import { setCredentials } from '../../store/slices/authSlice';
import { baseApi } from '../../store/api/baseApi';
import AmbikaLogo from '../../assets/ambikalogo.jpeg';

const Feature = ({ icon: Icon, title, desc }) => (
  <Box sx={{ display: 'flex', gap: 1.75, alignItems: 'flex-start' }}>
    <Box
      sx={{
        width: 38, height: 38, borderRadius: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.14)',
        border: '1px solid rgba(255,255,255,0.22)',
        backdropFilter: 'blur(8px)',
        color: '#ffffff',
        flexShrink: 0,
      }}
    >
      <Icon size={18} strokeWidth={2.2} />
    </Box>
    <Box>
      <Typography sx={{ color: '#ffffff', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3 }}>{title}</Typography>
      <Typography sx={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.82rem', lineHeight: 1.5 }}>{desc}</Typography>
    </Box>
  </Box>
);

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [login, { isLoading, error }] = useLoginMutation();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await login({ email, password }).unwrap();
      // Clear any cached data from a previous session before this user's queries run,
      // so a new login never shows the old user's data (until a manual refresh).
      dispatch(baseApi.util.resetApiState());
      dispatch(setCredentials({ user: response.data.user, token: response.data.token }));
      navigate('/dashboard');
    } catch (err) {
      console.error('Failed to log in:', err);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'stretch',
        backgroundColor: 'background.default',
        backgroundImage:
          'radial-gradient(at 0% 0%, rgba(59,130,246,0.10) 0px, transparent 50%),' +
          'radial-gradient(at 100% 100%, rgba(91,108,255,0.10) 0px, transparent 50%)',
      }}
    >
      {/* LEFT — Brand Panel */}
      <Box
        sx={{
          flex: 1.1,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 45%, #1d4ed8 100%)',
          color: '#ffffff',
        }}
      >
        {/* decorative orbs */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 420, height: 420, borderRadius: '50%',
            top: -120, right: -120,
            background: 'radial-gradient(circle, rgba(96,165,250,0.35) 0%, rgba(96,165,250,0) 60%)',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 340, height: 340, borderRadius: '50%',
            bottom: -100, left: -80,
            background: 'radial-gradient(circle, rgba(91,108,255,0.30) 0%, rgba(91,108,255,0) 60%)',
          }}
        />

        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 1.75 }}>
          <Box
            sx={{
              width: 52, height: 52, borderRadius: 2.5,
              overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.25)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <img src={AmbikaLogo} alt="Ambika" style={{ width: 42, height: 42, objectFit: 'contain' }} />
          </Box>
          <Box>
            <Typography sx={{ color: '#ffffff', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.01em' }}>
              AGL ERP
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.78)', fontWeight: 600, fontSize: '0.72rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              Planning &middot; Execution Suite
            </Typography>
          </Box>
        </Box>

        <Box sx={{ position: 'relative', maxWidth: 480 }}>
          <Chip
            label="ENTERPRISE EDITION"
            sx={{
              mb: 3,
              backgroundColor: 'rgba(255,255,255,0.12)',
              color: '#ffffff',
              border: '1px solid rgba(255,255,255,0.22)',
              fontWeight: 700,
              letterSpacing: '0.12em',
              fontSize: '0.66rem',
            }}
          />
          <Typography
            sx={{
              color: '#ffffff',
              fontSize: { md: '2.1rem', lg: '2.5rem' },
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
              mb: 2,
            }}
          >
            Plan, dispatch & track —<br />all in one command center.
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', lineHeight: 1.6, mb: 4 }}>
            A unified workspace for sales orders, production planning, and dispatch execution, built for high-velocity operations teams.
          </Typography>

          <Stack spacing={2.25}>
            <Feature icon={BarChart3}   title="Real-time intelligence"     desc="Live KPIs, fulfillment trends, and client risk in a single view." />
            <Feature icon={Truck}       title="Plan to dispatch, seamlessly" desc="From order intake through PPC, challan, and invoice." />
            <Feature icon={ShieldCheck} title="Role-based access control"   desc="Secure, audited, and aligned to your org structure." />
          </Stack>
        </Box>

        <Typography sx={{ position: 'relative', color: 'rgba(255,255,255,0.65)', fontSize: '0.78rem' }}>
          © {new Date().getFullYear()} AGL ERP. All rights reserved.
        </Typography>
      </Box>

      {/* RIGHT — Form Panel */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 3, sm: 6 },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: '100%',
            maxWidth: 440,
            p: { xs: 3.5, sm: 5 },
            borderRadius: 4,
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: '0 24px 60px rgba(30, 58, 138, 0.10)',
            background: 'linear-gradient(180deg, #ffffff 0%, #f5f8ff 100%)',
          }}
        >
          {/* mobile-only brand */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1.25, mb: 2.5 }}>
            <img src={AmbikaLogo} alt="AGL ERP" style={{ width: 36, height: 36, borderRadius: 8 }} />
            <Typography sx={{ fontWeight: 800, color: 'primary.dark' }}>AGL ERP</Typography>
          </Box>

          <Typography
            variant="h4"
            sx={{ fontWeight: 800, color: 'primary.dark', letterSpacing: '-0.02em', mb: 0.75 }}
          >
            Welcome back
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: '0.92rem', mb: 4 }}>
            Sign in to your dispatch workspace to continue.
          </Typography>

          <form onSubmit={handleSubmit} noValidate>
            <Stack spacing={2.25}>
              <Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'primary.dark', mb: 0.75, letterSpacing: '0.02em' }}>
                  Email address
                </Typography>
                <TextField
                  fullWidth
                  size="medium"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Mail size={18} color="#1d4ed8" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>

              <Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'primary.dark', mb: 0.75, letterSpacing: '0.02em' }}>
                  Password
                </Typography>
                <TextField
                  fullWidth
                  size="medium"
                  placeholder="••••••••"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Lock size={18} color="#1d4ed8" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowPwd((v) => !v)}
                          edge="end"
                          size="small"
                          aria-label="toggle password visibility"
                        >
                          {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>

              {error && (
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'rgba(190, 18, 60, 0.06)',
                    border: '1px solid',
                    borderColor: 'rgba(190, 18, 60, 0.22)',
                  }}
                >
                  <Typography sx={{ color: 'error.main', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center' }}>
                    {error.data?.message || 'Sign in failed. Please verify your credentials.'}
                  </Typography>
                </Paper>
              )}

              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={isLoading}
                endIcon={!isLoading && <ArrowRight size={18} />}
                sx={{
                  py: 1.5,
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                  borderRadius: 2.5,
                  mt: 0.5,
                }}
              >
                {isLoading ? <CircularProgress size={22} sx={{ color: 'white' }} /> : 'Sign in to workspace'}
              </Button>

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 1 }}>
                <ShieldCheck size={14} color="#1e3a8a" />
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary' }}>
                  Secured with enterprise-grade authentication
                </Typography>
              </Box>
            </Stack>
          </form>
        </Paper>
      </Box>
    </Box>
  );
};

export default Login;
