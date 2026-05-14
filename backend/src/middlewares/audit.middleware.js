import AuditLog from '../modules/audit-logs/audit-log.model.js';

/**
 * Enterprise Audit Middleware
 * Intercepts mutations (POST, PUT, PATCH, DELETE) and asynchronously logs them.
 * @param {String} entityName - Name of the entity being modified (e.g., 'DispatchActual')
 * @param {String} moduleName - Name of the domain module (e.g., 'dispatch')
 */
export const auditMiddleware = (entityName, moduleName) => {
  return async (req, res, next) => {
    // Only intercept state-changing requests
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const originalSend = res.send;
      
      // Monkey-patch res.send to capture the response data
      res.send = function (data) {
        // Offload the DB write to the next tick to prevent blocking the response
        setImmediate(async () => {
          try {
            let action = 'CREATE';
            if (req.method === 'PUT' || req.method === 'PATCH') action = 'UPDATE';
            if (req.method === 'DELETE') action = 'DELETE'; // Adjust to SOFT_DELETE if applicable

            let parsedData;
            try { parsedData = JSON.parse(data); } catch (e) { parsedData = data; }
            
            // Attempt to extract the ID of the created/updated resource
            const entityId = req.params.id || parsedData?.data?._id;

            if (entityId) {
              await AuditLog.create({
                entityName,
                module: moduleName,
                entityId,
                action,
                // In a robust implementation, you would diff the old state from the DB vs req.body
                newValue: req.body, 
                updatedBy: req.user?._id || null,
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
              });
            }
          } catch (error) {
            console.error(`[AuditMiddleware Error] Failed to log ${action} on ${entityName}:`, error);
          }
        });
        
        // Return control to Express
        originalSend.apply(res, arguments);
      };
    }
    next();
  };
};
