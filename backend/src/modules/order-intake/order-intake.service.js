import OrderIntake, { INTAKE_STATUS } from './order-intake.model.js';
import Party from '../clients/party.model.js';
import { orderService } from '../order/order.service.js';
import { o2dFmsService } from '../o2d-fms/o2d-fms.service.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';

export const orderIntakeService = {
  async create(data, actor) {
    let partyName = data.partyName;
    if (!partyName && data.partyId) {
      const party = await Party.findById(data.partyId).select('name').lean();
      partyName = party?.name;
    }
    const count = await OrderIntake.estimatedDocumentCount();
    const intake = await OrderIntake.create({
      ...data,
      partyName,
      intakeNo: `AGL-OI-${count + 1}`,
      createdBy: actor?._id,
    });

    // Saving an intake STARTS the FMS (non-fatal).
    try {
      await o2dFmsService.buildProcessForIntake(intake);
    } catch (err) {
      logger.error(`[order-intake] FMS start failed for ${intake.intakeNo}: ${err.message}`);
    }
    return intake;
  },

  async list(query) {
    const features = new ApiFeatures(OrderIntake.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['intakeNo', 'partyName', 'contactName', 'notes']).sort().paginate()
      .populateRefs([{ path: 'partyId', select: 'name code' }, { path: 'createdBy', select: 'name' }]);
    return features.exec();
  },

  async getById(id) {
    const intake = await OrderIntake.findById(id).populate('partyId createdBy linkedSalesOrderId', 'name code soNumber').lean();
    if (!intake) throw new AppError('Order intake not found', 404);
    return intake;
  },

  /** Convert an intake into a formal Sales Order, linking the existing FMS process. */
  async convertToOrder(id, overrides = {}, actor) {
    const intake = await OrderIntake.findById(id);
    if (!intake) throw new AppError('Order intake not found', 404);
    if (intake.intakeStatus === INTAKE_STATUS.CONVERTED) throw new AppError('This intake is already converted', 409);

    const srcItems = (overrides.items && overrides.items.length) ? overrides.items : intake.items;
    const items = (srcItems || [])
      .filter((it) => it.skuName && Number(it.qty || it.orderQty) > 0)
      .map((it) => ({
        skuName: it.skuName,
        skuCode: it.skuCode || it.skuName,
        orderQty: Number(it.qty || it.orderQty),
      }));
    if (!items.length) throw new AppError('Add at least one item (with quantity) to create the Sales Order', 422);

    const order = await orderService.create({
      partyId: intake.partyId,
      partyName: intake.partyName,
      poNumber: overrides.poNumber || undefined,
      orderDate: overrides.orderDate || new Date(),
      receivedAt: intake.receivedAt || new Date(),
      items,
      remark: intake.notes || undefined,
      intakeId: intake._id,        // tells orderService to reuse the intake's process
      createdBy: actor?._id,
    });

    intake.intakeStatus = INTAKE_STATUS.CONVERTED;
    intake.linkedSalesOrderId = order._id;
    intake.updatedBy = actor?._id;
    await intake.save();

    return { intake: intake.toObject(), order };
  },

  async cancel(id, actor) {
    const intake = await OrderIntake.findByIdAndUpdate(
      id, { $set: { intakeStatus: INTAKE_STATUS.CANCELLED, updatedBy: actor?._id } }, { new: true });
    if (!intake) throw new AppError('Order intake not found', 404);
    return intake.toObject();
  },

  /**
   * MD-only hard removal (soft-delete). Allowed for ANY status, including
   * CONVERTED. If the intake was never converted, its FMS process is retired
   * too; a converted intake's process belongs to the Sales Order and is kept.
   */
  async remove(id, actor) {
    const intake = await OrderIntake.findById(id);
    if (!intake) throw new AppError('Order intake not found', 404);

    intake.isDeleted = true;
    intake.updatedBy = actor?._id;
    await intake.save();

    if (intake.intakeStatus !== INTAKE_STATUS.CONVERTED) {
      try {
        const { O2DProcess } = await import('../o2d-fms/o2d-fms.model.js');
        await O2DProcess.updateOne(
          { intakeId: intake._id, salesOrderId: null },
          { $set: { isDeleted: true, updatedBy: actor?._id } },
        );
      } catch (err) {
        logger.error(`[order-intake] FMS cleanup failed for ${intake.intakeNo}: ${err.message}`);
      }
    }
    return { id: intake._id, intakeNo: intake.intakeNo };
  },
};

export default orderIntakeService;
