import { useNavigate } from 'react-router-dom';

/**
 * History-aware "Back" for in-page back buttons.
 *
 * Returns a handler that goes to the PREVIOUS page in history — so a doer who
 * arrived from the O2D Step Board lands back on the Step Board, not on some
 * hardcoded list. Only when there is no history (deep link / fresh tab) does
 * it fall back to the given route, so the button never dead-ends.
 *
 *   const goBack = useSmartBack('/orders');
 *   <IconButton onClick={goBack}>…
 */
export function useSmartBack(fallback = '/dashboard') {
  const navigate = useNavigate();
  return () => {
    const canGoBack = typeof window !== 'undefined' && window.history.state && window.history.state.idx > 0;
    if (canGoBack) navigate(-1);
    else navigate(fallback);
  };
}

export default useSmartBack;
