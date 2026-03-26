// ---------------------------------------------------------------------------
// Messaging module — Pulsar-inspired topic/subscription system
// ---------------------------------------------------------------------------

// -- Admin API (SA-2g) -------------------------------------------------------
export type { SubscriptionInfo, TopicInfo } from "./admin";
export { inspectSubscription, listTopics, resetCursor } from "./admin";
// -- Transport implementations -----------------------------------------------
export type { H2TransportOpts } from "./h2Transport";
export { h2MessageTransport } from "./h2Transport";
// -- Core messaging ----------------------------------------------------------
export { jobFlow } from "./jobFlow";
export { jobQueue } from "./jobQueue";
export { repeatPublish } from "./repeatPublish";
export { subscription } from "./subscription";
export { topic } from "./topic";
// -- Topic bridge (SA-2d) ----------------------------------------------------
export type { BridgedTopic, TopicBridgeOpts, TopicBridgeResult } from "./topicBridge";
export { topicBridge } from "./topicBridge";
// -- Transport types (SA-2a) -------------------------------------------------
export type {
	AckEnvelope,
	AdminEnvelope,
	BackpressureEnvelope,
	MessageFilter,
	MessageTransport,
	PublishEnvelope,
	SubscribeEnvelope,
	TransportEnvelope,
	TransportStatus,
	UnsubscribeEnvelope,
} from "./transportTypes";
// -- Types -------------------------------------------------------------------
export type {
	AddJobOptions,
	ConsumerGroup,
	JobEvent,
	JobFlow,
	JobFlowEdge,
	JobFlowOptions,
	JobInfo,
	JobQueue,
	JobQueueOptions,
	JobStatus,
	MessageMeta,
	MessageSchema,
	PublishOptions,
	RepeatHandle,
	RepeatPublishOptions,
	StallAction,
	SubscriptionMode,
	SubscriptionOptions,
	Topic,
	TopicInternalAccess,
	TopicMessage,
	TopicOptions,
	TopicSubscription,
} from "./types";
export type { WsTransportOpts } from "./wsTransport";
export { wsMessageTransport } from "./wsTransport";
