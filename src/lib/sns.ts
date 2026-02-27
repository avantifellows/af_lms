import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const snsClient = new SNSClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AF_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AF_SECRET_ACCESS_KEY ?? "",
  },
});

export async function publishMessage(message: Record<string, unknown>) {
  const topicArn = process.env.AF_TOPIC_ARN;
  const environment = process.env.APP_ENV ?? "production";
  const payload = JSON.stringify({ environment, ...message });

  if (!topicArn) {
    console.error("[SNS ERROR] Missing AF_TOPIC_ARN");
    return;
  }

  if (environment === "testing") {
    console.info("[SNS DEBUG] publishing message:", payload);
    return;
  }

  try {
    const command = new PublishCommand({ Message: payload, TopicArn: topicArn });
    const data = await snsClient.send(command);
    console.info("[SNS SUCCESS] publishing message:", data.MessageId);
  } catch (error) {
    console.error("[SNS ERROR] publishing message:", error);
  }
}
