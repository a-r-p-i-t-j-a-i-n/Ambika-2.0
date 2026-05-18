import { useMemo } from 'react';
import { useSelector } from 'react-redux';

/**
 * Permission hooks — server is the source of truth; this is a UX courtesy.
 *
 *   const can         = usePermission('pricing.revise');
 *   const { isRoot, canAny, canAll } = usePermissions();
 *
 * If the user has the root sentinel (granted by the MD role) every check
 * returns true.
 */

const ROOT = '*';

export const usePermissions = () => {
  const { permissions = [], isRoot } = useSelector((s) => s.auth);
  return useMemo(() => {
    const set = new Set(permissions);
    const root = !!isRoot || set.has(ROOT);
    const has = (slug) => root || set.has(slug);
    return {
      isRoot: root,
      permissions: set,
      can: has,
      canAny: (...slugs) => slugs.some(has),
      canAll: (...slugs) => slugs.every(has),
    };
  }, [permissions, isRoot]);
};

export const usePermission = (slug) => usePermissions().can(slug);

export default usePermission;
