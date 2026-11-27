const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { ApiError } = require('../utils/ApiError');
const service = require('../services/advertiserRequestService');

const getRateCard = asyncHandler(async (_req, res) => {
  res.json(ApiResponse.success('Advertiser rate card loaded', await service.getRateCard()));
});

const updateRateCard = asyncHandler(async (req, res) => {
  const rateCard = await service.updateRateCard(req.user.id, req.body || {});
  res.json(ApiResponse.success('Advertiser rate card saved', rateCard));
});

const getInventory = asyncHandler(async (_req, res) => {
  res.json(ApiResponse.success('Ad-ready video inventory loaded', await service.listEligibleVideos()));
});

const createRequest = asyncHandler(async (req, res) => {
  const request = await service.createRequest({ user: req.user, profile: req.profile, file: req.file, fields: req.body || {} });
  res.status(201).json(ApiResponse.success('Advertiser request submitted', request));
});

const listRequests = asyncHandler(async (req, res) => {
  const requests = req.profile?.role === 'admin'
    ? await service.listAdminRequests()
    : await service.listOwnerRequests(req.user.id);
  res.json(ApiResponse.success('Advertiser requests loaded', requests));
});

const getRequest = asyncHandler(async (req, res) => {
  const request = await service.getRequest(req.params.id, req.profile?.role === 'admin' ? {} : { ownerId: req.user.id });
  res.json(ApiResponse.success('Advertiser request loaded', request));
});

const issueQuote = asyncHandler(async (req, res) => {
  const request = await service.issueQuote(req.params.id, req.body || {}, req.user.id);
  res.json(ApiResponse.success('Quote issued to advertiser', request));
});

const confirmPayment = asyncHandler(async (req, res) => {
  const request = await service.confirmPayment(req.params.id, req.body?.paymentReference, req.user.id);
  service.enqueue(request.id);
  res.json(ApiResponse.success('Payment confirmed. Receipt issued and logo rendering queued.', request));
});

const submitPaymentReference = asyncHandler(async (req, res) => {
  const request = await service.submitPaymentReference(req.params.id, req.user.id, req.body?.paymentReference);
  res.json(ApiResponse.success('Payment reference submitted for admin verification', request));
});

const rejectRequest = asyncHandler(async (req, res) => {
  const request = await service.rejectRequest(req.params.id, req.body?.reason);
  res.json(ApiResponse.success('Advertiser request declined', request));
});

const retryRequest = asyncHandler(async (req, res) => {
  const request = await service.retryRequest(req.params.id);
  res.status(202).json(ApiResponse.success('Failed video renders queued for retry', request));
});

const getReceipt = asyncHandler(async (req, res) => {
  const request = await service.getRequest(req.params.id, req.profile?.role === 'admin' ? {} : { ownerId: req.user.id });
  if (!['paid', 'processing', 'completed', 'partial', 'failed'].includes(request.status) || !request.receiptNumber) {
    throw new ApiError(409, 'A payment receipt will be available after the administrator confirms payment');
  }
  res.json(ApiResponse.success('Payment receipt loaded', request));
});

module.exports = { getRateCard, updateRateCard, getInventory, createRequest, listRequests, getRequest, issueQuote, confirmPayment, submitPaymentReference, rejectRequest, retryRequest, getReceipt };
