import React, { createContext, useContext, useReducer, useMemo } from 'react';
import { initialMockState } from '../mock-data/dpesMockData';
import dayjs from 'dayjs';

const DispatchContext = createContext();

const actionTypes = {
  ADD_EXECUTION: 'ADD_EXECUTION',
  ADD_PLAN: 'ADD_PLAN'
};

function dispatchReducer(state, action) {
  switch (action.type) {
    case actionTypes.ADD_EXECUTION: {
      const { planId, actualQty, executionDate, referenceNumber } = action.payload;
      // Replace any existing execution for the same plan (one per plan)
      const filtered = state.executions.filter(e => e.planId !== planId);
      return {
        ...state,
        executions: [
          ...filtered,
          { id: `exec-${Date.now()}`, planId, actualQty: Number(actualQty), executionDate, referenceNumber }
        ]
      };
    }
    case actionTypes.ADD_PLAN: {
      const { orderId, date, plannedQty } = action.payload;
      return {
        ...state,
        plans: [
          ...state.plans,
          { id: `PLN-${Date.now()}`, orderId, date, plannedQty: Number(plannedQty) }
        ]
      };
    }
    default:
      return state;
  }
}

export function useDispatch() {
  return useContext(DispatchContext);
}

export function DispatchProvider({ children }) {
  const [state, dispatch] = useReducer(dispatchReducer, initialMockState);

  const getTimelineForOrder = (orderId) => {
    const plans = state.plans
      .filter(p => p.orderId === orderId)
      .sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf());

    let accumulatedCarry = 0;

    return plans.map((plan, idx) => {
      const execution = state.executions.find(e => e.planId === plan.id);
      const expectedTotal = plan.plannedQty + accumulatedCarry;
      let actualQty = execution ? execution.actualQty : 0;
      let status = 'Pending';
      let resultCarry = 0;

      if (execution) {
        if (actualQty >= expectedTotal) {
          status = 'Done';
          resultCarry = 0;
        } else {
          status = 'WIP';
          resultCarry = expectedTotal - actualQty;
        }
      } else {
        if (dayjs().isAfter(dayjs(plan.date))) {
          status = 'Delayed';
          resultCarry = expectedTotal;
        } else {
          resultCarry = accumulatedCarry;
        }
      }

      return {
        ...plan,
        expectedTotal,
        inheritedCarry: accumulatedCarry,
        actualQty,
        resultCarryForward: resultCarry,
        status,
        statusColor: status === 'Done' ? 'success' : status === 'WIP' ? 'warning' : status === 'Delayed' ? 'error' : 'info',
        referenceNumber: execution?.referenceNumber || null,
        executionDate: execution?.executionDate || null,
      };
    });
  };

  const getLedger = () => {
    let ledger = [];
    state.orders.forEach(order => {
      const timeline = getTimelineForOrder(order.id);
      timeline.forEach(t => {
        ledger.push({ ...t, customer: order.customer, item: order.item, orderId: order.id });
      });
    });
    return ledger.sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf());
  };

  const submitExecution = (planId, actualQty, date, referenceNumber) => {
    dispatch({ type: actionTypes.ADD_EXECUTION, payload: { planId, actualQty, executionDate: date, referenceNumber } });
  };

  const addPlan = (orderId, date, plannedQty) => {
    dispatch({ type: actionTypes.ADD_PLAN, payload: { orderId, date, plannedQty } });
  };

  const getDashboardMetrics = () => {
    let totalPlanned = 0, totalActual = 0, delayedPlansCount = 0, totalPlans = 0;
    state.orders.forEach(order => {
      const timeline = getTimelineForOrder(order.id);
      timeline.forEach(t => {
        totalPlans++;
        totalPlanned += t.plannedQty;
        totalActual += t.actualQty;
        if (t.status === 'Delayed') delayedPlansCount++;
      });
    });
    const completionRate = totalPlanned === 0 ? 0 : (totalActual / totalPlanned) * 100;
    return { totalPlanned, totalActual, delayedPlansCount, totalPlans, completionRate };
  };

  const value = useMemo(() => ({
    state,
    submitExecution,
    addPlan,
    getTimelineForOrder,
    getLedger,
    getDashboardMetrics
  }), [state]);

  return <DispatchContext.Provider value={value}>{children}</DispatchContext.Provider>;
}