import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { Compass, Home, ArrowLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

const NotFound = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 3, sm: 6 },
        background: 'linear-gradient(135deg, #eef3fc 0%, #f5f8ff 100%)',
      }}
    >
      <Paper
        elevation={0}
        sx={{
          maxWidth: 520,
          width: '100%',
          p: { xs: 3.5, sm: 5 },
          borderRadius: 4,
          border: '1px solid #dbe4f3',
          boxShadow: '0 24px 60px rgba(30, 58, 138, 0.10)',
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            width: 64,
            height: 64,
            mx: 'auto',
            mb: 2.5,
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              'linear-gradient(135deg, rgba(29,78,216,0.08) 0%, rgba(29,78,216,0.18) 100%)',
            border: '1px solid rgba(29,78,216,0.20)',
            color: '#1d4ed8',
          }}
        >
          <Compass size={28} strokeWidth={2.2} />
        </Box>

        <Typography
          sx={{
            fontSize: { xs: '2.4rem', sm: '3rem' },
            fontWeight: 900,
            color: '#1e3a8a',
            letterSpacing: '-0.03em',
            lineHeight: 1,
            mb: 0.5,
          }}
        >
          404
        </Typography>
        <Typography
          sx={{
            fontSize: '1.15rem',
            fontWeight: 700,
            color: '#0b2545',
            mb: 1,
          }}
        >
          Page not found
        </Typography>
        <Typography
          sx={{
            fontSize: '0.88rem',
            color: '#475a8a',
            mb: 3.5,
            lineHeight: 1.6,
          }}
        >
          The page <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace', color: '#1d4ed8' }}>{location.pathname}</Box> doesn't exist or has been moved.
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<Home size={16} />}
            onClick={() => navigate('/dashboard', { replace: true })}
            sx={{ fontWeight: 700, px: 3 }}
          >
            Go to dashboard
          </Button>
          <Button
            variant="outlined"
            startIcon={<ArrowLeft size={16} />}
            onClick={() => navigate(-1)}
            sx={{ fontWeight: 700, px: 3 }}
          >
            Back
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};

export default NotFound;
