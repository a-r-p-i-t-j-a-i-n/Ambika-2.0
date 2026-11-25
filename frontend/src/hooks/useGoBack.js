import { useNavigate } from 'react-router-dom';

/**
 * The "Back" behaviour on its own: the PREVIOUS page in history (navigate(-1));
 * with no history (a deep link), the fallback `to` (default: dashboard), so it
 * never dead-ends. Used by <BackButton> and by headers that draw their own back
 * button (the IMS page shell's `onBack`).
 */
export const useGoBack = (to = '/dashboard') => {
  const navigate = useNavigate();
  return () => {
    // window.history.state.idx > 0 means there IS a previous entry to go back to.
    const canGoBack = typeof window !== 'undefined' && window.history.state && window.history.state.idx > 0;
    if (canGoBack) navigate(-1);
    else navigate(to);
  };
};

export default useGoBack;
