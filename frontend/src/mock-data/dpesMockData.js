import dayjs from 'dayjs';

export const initialMockState = {
  orders: [
    { id: 'ORD-1001', customer: 'Beverage Co.', item: 'Glass Jar 500ml', totalQty: 100000, orderDate: '2025-01-10', status: 'Active' },
    { id: 'ORD-1002', customer: 'FoodPack Ltd', item: 'PET Bottle 1L', totalQty: 75000, orderDate: '2025-01-15', status: 'Active' },
  ],
  plans: [
    { id: 'PLN-101', orderId: 'ORD-1001', date: '2025-03-24', plannedQty: 25000 },
    { id: 'PLN-102', orderId: 'ORD-1001', date: '2025-04-01', plannedQty: 15000 },
    { id: 'PLN-103', orderId: 'ORD-1001', date: '2025-04-08', plannedQty: 20000 },
    { id: 'PLN-201', orderId: 'ORD-1002', date: '2025-03-25', plannedQty: 30000 },
    { id: 'PLN-202', orderId: 'ORD-1002', date: '2025-04-02', plannedQty: 25000 },
  ],
  executions: [
    { id: 'EX-001', planId: 'PLN-101', actualQty: 20000, executionDate: '2025-03-26', referenceNumber: 'CH-24001' },
    // No execution for PLN-102 yet -> will cause carry-forward
  ],
};