import React from 'react';
import { Box, Skeleton, Paper } from '@mui/material';

const TableSkeleton = ({ rows = 8, columns = 5 }) => {
  return (
    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, p: 3 }}>
      {/* Header Skeleton */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Skeleton variant="text" width={200} height={32} sx={{ borderRadius: 1 }} />
          <Skeleton variant="text" width={300} height={18} sx={{ borderRadius: 1, mt: 0.5 }} />
        </Box>
        <Skeleton variant="rectangular" width={140} height={40} sx={{ borderRadius: '10px' }} />
      </Box>

      {/* Search Bar Skeleton */}
      <Paper sx={{ p: 2, borderRadius: '16px' }}>
        <Skeleton variant="rectangular" width={300} height={36} sx={{ borderRadius: '10px' }} />
      </Paper>

      {/* Grid Skeleton */}
      <Paper sx={{ borderRadius: '16px', overflow: 'hidden', p: 0 }}>
        {/* Column Headers */}
        <Box sx={{ display: 'flex', gap: 2, p: 2, bgcolor: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} variant="text" width={`${100 / columns}%`} height={16} sx={{ borderRadius: 1 }} />
          ))}
        </Box>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <Box 
            key={rowIndex} 
            sx={{ 
              display: 'flex', 
              gap: 2, 
              p: 1.5, 
              px: 2, 
              borderBottom: '1px solid #f1f5f9',
              bgcolor: rowIndex % 2 === 0 ? '#fff' : '#fafbfc',
            }}
          >
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton 
                key={colIndex} 
                variant="text" 
                width={`${100 / columns}%`} 
                height={18}
                sx={{ borderRadius: 1 }}
              />
            ))}
          </Box>
        ))}
      </Paper>
    </Box>
  );
};

export default TableSkeleton;
