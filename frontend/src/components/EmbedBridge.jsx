import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import AppLoader from './AppLoader';
import { setCredentials, logout } from '../store/slices/authSlice';
import { baseApi } from '../store/api/baseApi';
import { accessControlApi } from '../store/api/accessControlApi';
import { isEmbedded, isShellMessage, postToShell, setHiddenSteps, setStepRights } from '../utils/embed';

// ─────────────────────────────────────────────────────────────────────────────
// EmbedBridge — the ERP half of the Delegation Suite embedding.
//
// Standalone (not framed by the Suite) it renders its children untouched.
// Embedded, it:
//   1. drops any ERP session already in this browser and tells the Suite it is
//      ready (`erp:ready`);
//   2. swaps the Suite's 60-second ticket (`shell:auth`) for a normal ERP
//      session via POST /auth/sso, then reports `erp:auth-ok` / `erp:auth-failed`;
//   3. follows the Suite's sidebar (`shell:navigate`, applied with replace) and
//      reports its own navigation back (`erp:route`) so the Suite's address bar,
//      refresh and Back stay correct;
//   4. on a 401 anywhere (the auth slice is logged out) asks for a fresh ticket
//      (`erp:need-auth`) instead of showing the ERP login form;
//   5. reports the user's ERP permissions (`erp:access`) so the Suite can hide
//      ERP screens this user cannot open.
// Until signed in it shows the loader in place of the app, so ProtectedRoute
// never gets the chance to send the user to /login.
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1').replace(/\/+$/, '');
const DEFAULT_PATH = '/fms/my-tasks';
const SSO_TIMEOUT_MS = 20000;
const FAILURE_CODES = new Set(['no-account', 'inactive', 'invalid-ticket', 'incomplete-profile']);

const isLoginPath = (path) => path.split('?')[0] === '/login';
// Only paths inside this app: "/x" — never "//host" or a full URL.
const isAppPath = (path) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');

const selectMyAccess = accessControlApi.endpoints.getMyAccess.select();

const EmbeddedSession = ({ children }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useSelector((s) => s.auth.isAuthenticated);
  const myAccess = useSelector(selectMyAccess);
  // 'waiting' — asked the Suite for a ticket · 'ready' — signed in through a
  // ticket · 'failed' — the Suite shows the user why.
  const [status, setStatus] = useState('waiting');

  const currentPath = location.pathname + location.search;
  // Latest location for the async sign-in callback, and the last real screen
  // (never /login) to return to once signed in.
  const pathRef = useRef(currentPath);
  const lastAppPathRef = useRef(isLoginPath(currentPath) ? DEFAULT_PATH : currentPath);
  // Only the newest ticket's result counts if two sign-ins ever overlap.
  const ssoSeqRef = useRef(0);

  useEffect(() => {
    pathRef.current = currentPath;
    if (!isLoginPath(currentPath)) lastAppPathRef.current = currentPath;
  }, [currentPath]);

  // Listen first, then announce readiness (the boot effect below).
  useEffect(() => {
    const signIn = async (ticket) => {
      ssoSeqRef.current += 1;
      const seq = ssoSeqRef.current;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SSO_TIMEOUT_MS);
      let reason = 'network';
      try {
        const res = await fetch(`${API_URL}/auth/sso`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ticket }),
          signal: controller.signal,
        });
        const body = await res.json().catch(() => null);
        if (seq !== ssoSeqRef.current) return;
        const { token, user } = body?.data || {};
        if (res.ok && token && user) {
          // Same order as the login screen: clear any cached data, then store
          // the session (before flipping to 'ready', so a render in between
          // can never look like a lost session).
          dispatch(baseApi.util.resetApiState());
          dispatch(setCredentials({ user, token }));
          setStatus('ready');
          postToShell('erp:auth-ok', { email: user.email });
          if (isLoginPath(pathRef.current)) {
            navigate(lastAppPathRef.current || DEFAULT_PATH, { replace: true });
          }
          return;
        }
        if (FAILURE_CODES.has(body?.code)) reason = body.code;
      } catch {
        // Network error or timeout — reported as 'network'.
      } finally {
        clearTimeout(timer);
      }
      if (seq !== ssoSeqRef.current) return;
      setStatus('failed');
      postToShell('erp:auth-failed', { reason });
    };

    const onMessage = (event) => {
      if (!isShellMessage(event)) return;
      const { type, ticket, path } = event.data;
      if (type === 'shell:auth' && typeof ticket === 'string' && ticket) {
        signIn(ticket);
      } else if (type === 'shell:navigate' && isAppPath(path) && path !== pathRef.current) {
        navigate(path, { replace: true });
      } else if (type === 'shell:prefs') {
        // O2D / Purchase steps switched off for this employee in the Suite,
        // and what they may change on the O2D Step Board.
        setHiddenSteps(event.data.hidden);
        setStepRights(event.data.rights);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [dispatch, navigate]);

  // Boot: never reuse an ERP session someone else left in this browser — inside
  // the Suite the session always comes from the Suite user's own ticket.
  useEffect(() => {
    dispatch(logout());
    dispatch(baseApi.util.resetApiState());
    postToShell('erp:ready');
  }, [dispatch]);

  const signedIn = status === 'ready' && isAuthenticated;
  // Signed in through a ticket, then logged out by a 401 somewhere.
  const needsAuth = status === 'ready' && !isAuthenticated;

  useEffect(() => {
    if (signedIn && !isLoginPath(currentPath)) postToShell('erp:route', { path: currentPath });
  }, [signedIn, currentPath]);

  useEffect(() => {
    if (needsAuth) postToShell('erp:need-auth');
  }, [needsAuth]);

  // Permissions arrive once AccessHydrator has loaded /access-control/me.
  const access = myAccess?.data?.data;
  const accessKey = signedIn && access
    ? JSON.stringify({ isRoot: !!access.isRoot, permissions: Array.isArray(access.permissions) ? access.permissions : [] })
    : '';

  useEffect(() => {
    if (accessKey) postToShell('erp:access', JSON.parse(accessKey));
  }, [accessKey]);

  if (signedIn) return children;

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
      {status === 'failed' ? (
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: 'text.secondary', px: 3, textAlign: 'center' }}>
          Could not sign you in to the ERP.
        </Typography>
      ) : (
        <AppLoader label="Signing you in…" />
      )}
    </Box>
  );
};

const EmbedBridge = ({ children }) => (isEmbedded ? <EmbeddedSession>{children}</EmbeddedSession> : children);

export default EmbedBridge;
