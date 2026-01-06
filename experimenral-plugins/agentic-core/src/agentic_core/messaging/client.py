"""Kafka client for message bus operations."""

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from uuid import uuid4

from confluent_kafka import Consumer, KafkaError, KafkaException, Producer
from confluent_kafka.admin import AdminClient, NewTopic

from agentic_core.messaging.schemas import (
    AgentMessage,
    BaseMessage,
    ControlSignal,
    WorkflowEvent,
)
from agentic_core.messaging.topics import TopicConfig, Topics


@dataclass
class ConsumedMessage:
    """A message consumed from Kafka."""

    topic: str
    partition: int
    offset: int
    key: Optional[str]
    value: str
    timestamp: datetime


class KafkaClient:
    """Kafka client for pub/sub messaging."""

    def __init__(self, bootstrap_servers: Optional[str] = None):
        """Initialize Kafka client."""
        self.bootstrap_servers = bootstrap_servers or os.environ.get(
            "AGENTIC_KAFKA_URL",
            "localhost:9094",
        )
        self._producer: Optional[Producer] = None
        self._consumers: dict[str, Consumer] = {}
        self._admin: Optional[AdminClient] = None

    def _get_producer(self) -> Producer:
        """Get or create producer."""
        if self._producer is None:
            self._producer = Producer(
                {
                    "bootstrap.servers": self.bootstrap_servers,
                    "client.id": f"agentic-producer-{uuid4().hex[:8]}",
                }
            )
        return self._producer

    def _get_admin(self) -> AdminClient:
        """Get or create admin client."""
        if self._admin is None:
            self._admin = AdminClient({"bootstrap.servers": self.bootstrap_servers})
        return self._admin

    def _get_consumer(self, group_id: str, topics: list[str]) -> Consumer:
        """Get or create consumer for a group."""
        key = f"{group_id}:{','.join(sorted(topics))}"
        if key not in self._consumers:
            consumer = Consumer(
                {
                    "bootstrap.servers": self.bootstrap_servers,
                    "group.id": group_id,
                    "client.id": f"agentic-consumer-{uuid4().hex[:8]}",
                    "auto.offset.reset": "earliest",
                    "enable.auto.commit": True,
                }
            )
            consumer.subscribe(topics)
            self._consumers[key] = consumer
        return self._consumers[key]

    def ensure_topics(self) -> None:
        """Ensure all required topics exist."""
        admin = self._get_admin()
        existing = set(admin.list_topics().topics.keys())

        new_topics = []
        for topic_config in Topics.all_topics():
            if topic_config.name not in existing:
                new_topics.append(
                    NewTopic(
                        topic_config.name,
                        num_partitions=3,
                        replication_factor=1,
                    )
                )

        if new_topics:
            futures = admin.create_topics(new_topics)
            for topic, future in futures.items():
                try:
                    future.result()
                except KafkaException as e:
                    if e.args[0].code() != KafkaError.TOPIC_ALREADY_EXISTS:
                        raise

    def produce(
        self,
        topic: TopicConfig,
        message: BaseMessage,
        key: Optional[str] = None,
    ) -> None:
        """Produce a message to a topic."""
        producer = self._get_producer()
        producer.produce(
            topic.name,
            value=message.to_json().encode("utf-8"),
            key=key.encode("utf-8") if key else None,
        )
        producer.poll(0)

    def flush(self, timeout: float = 10.0) -> int:
        """Flush pending messages."""
        if self._producer:
            return self._producer.flush(timeout)
        return 0

    def consume(
        self,
        topics: list[TopicConfig],
        group_id: str,
        timeout: float = 1.0,
    ) -> Optional[ConsumedMessage]:
        """Consume a single message."""
        topic_names = [t.name for t in topics]
        consumer = self._get_consumer(group_id, topic_names)

        msg = consumer.poll(timeout)
        if msg is None:
            return None
        if msg.error():
            if msg.error().code() == KafkaError._PARTITION_EOF:
                return None
            raise KafkaException(msg.error())

        return ConsumedMessage(
            topic=msg.topic(),
            partition=msg.partition(),
            offset=msg.offset(),
            key=msg.key().decode("utf-8") if msg.key() else None,
            value=msg.value().decode("utf-8"),
            timestamp=datetime.fromtimestamp(msg.timestamp()[1] / 1000),
        )

    def consume_batch(
        self,
        topics: list[TopicConfig],
        group_id: str,
        max_messages: int = 100,
        timeout: float = 1.0,
    ) -> list[ConsumedMessage]:
        """Consume a batch of messages."""
        messages = []
        for _ in range(max_messages):
            msg = self.consume(topics, group_id, timeout)
            if msg is None:
                break
            messages.append(msg)
        return messages

    def get_latest_offset(self, topic: TopicConfig, partition: int = 0) -> int:
        """Get the latest offset for a topic partition."""
        consumer = Consumer(
            {
                "bootstrap.servers": self.bootstrap_servers,
                "group.id": f"offset-check-{uuid4().hex[:8]}",
            }
        )
        try:
            # Get high watermark (latest offset)
            low, high = consumer.get_watermark_offsets(topic.name, partition, timeout=5.0)
            return high
        finally:
            consumer.close()

    def consume_from_offset(
        self,
        topic: TopicConfig,
        offset: int,
        group_id: str,
        partition: int = 0,
    ) -> list[ConsumedMessage]:
        """Consume all messages from a specific offset."""
        from confluent_kafka import TopicPartition

        consumer = Consumer(
            {
                "bootstrap.servers": self.bootstrap_servers,
                "group.id": group_id,
                "auto.offset.reset": "earliest",
                "enable.auto.commit": False,
            }
        )

        try:
            tp = TopicPartition(topic.name, partition, offset)
            consumer.assign([tp])

            messages = []
            while True:
                msg = consumer.poll(1.0)
                if msg is None:
                    break
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        break
                    raise KafkaException(msg.error())

                messages.append(
                    ConsumedMessage(
                        topic=msg.topic(),
                        partition=msg.partition(),
                        offset=msg.offset(),
                        key=msg.key().decode("utf-8") if msg.key() else None,
                        value=msg.value().decode("utf-8"),
                        timestamp=datetime.fromtimestamp(msg.timestamp()[1] / 1000),
                    )
                )

            return messages
        finally:
            consumer.close()

    # Convenience methods for specific message types

    def publish_workflow_event(
        self,
        workflow_id: str,
        event_type: str,
        workflow_name: str = "",
        step_name: Optional[str] = None,
        status: Optional[str] = None,
        error: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        """Publish a workflow event."""
        event = WorkflowEvent(
            message_id=str(uuid4()),
            timestamp=datetime.utcnow().isoformat(),
            workflow_id=workflow_id,
            event_type=event_type,
            workflow_name=workflow_name,
            step_name=step_name,
            status=status,
            error=error,
            metadata=metadata,
        )
        self.produce(Topics.WORKFLOW_EVENTS, event, key=workflow_id)

    def publish_agent_message(
        self,
        workflow_id: str,
        from_agent: str,
        content: str,
        to_agent: Optional[str] = None,
        message_type: str = "chat",
        metadata: Optional[dict] = None,
    ) -> None:
        """Publish an agent message."""
        message = AgentMessage(
            message_id=str(uuid4()),
            timestamp=datetime.utcnow().isoformat(),
            workflow_id=workflow_id,
            from_agent=from_agent,
            to_agent=to_agent,
            content=content,
            message_type=message_type,
            metadata=metadata,
        )
        self.produce(Topics.AGENT_MESSAGES, message, key=workflow_id)

    def publish_control_signal(
        self,
        workflow_id: str,
        signal_type: str,
        target_step: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> None:
        """Publish a control signal."""
        signal = ControlSignal(
            message_id=str(uuid4()),
            timestamp=datetime.utcnow().isoformat(),
            workflow_id=workflow_id,
            signal_type=signal_type,
            target_step=target_step,
            reason=reason,
        )
        self.produce(Topics.CONTROL_SIGNALS, signal, key=workflow_id)

    def close(self) -> None:
        """Close all connections."""
        if self._producer:
            self._producer.flush()
            self._producer = None
        for consumer in self._consumers.values():
            consumer.close()
        self._consumers.clear()
        self._admin = None

    def health_check(self) -> bool:
        """Check Kafka connectivity."""
        try:
            admin = self._get_admin()
            admin.list_topics(timeout=5)
            return True
        except Exception:
            return False


# Global Kafka client instance
_kafka_client: Optional[KafkaClient] = None


def get_kafka_client() -> KafkaClient:
    """Get or create the global Kafka client instance."""
    global _kafka_client
    if _kafka_client is None:
        _kafka_client = KafkaClient()
    return _kafka_client
