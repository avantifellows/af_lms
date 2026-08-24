import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const snsClient = new SNSClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AF_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AF_SECRET_ACCESS_KEY ?? "",
  },
});

/**
 * Publish to the sessionCreator topic. Never throws — a publish failure must not
 * fail a create that already succeeded — but RETURNS whether it published, so a
 * caller that records status can avoid claiming success when the Lambda was never
 * triggered. Existing callers that ignore the result keep their old behaviour.
 */
export async function publishMessage(
  message: Record<string, unknown>
): Promise<boolean> {
  const topicArn = process.env.AF_TOPIC_ARN;
  const environment = process.env.APP_ENV ?? "production";
  const payload = JSON.stringify({ environment, ...message });

  if (!topicArn) {
    console.error("[SNS ERROR] Missing AF_TOPIC_ARN");
    return false;
  }

  if (environment === "testing") {
    console.info("[SNS DEBUG] publishing message:", payload);
    return true;
  }

  try {
    const command = new PublishCommand({ Message: payload, TopicArn: topicArn });
    const data = await snsClient.send(command);
    console.info("[SNS SUCCESS] publishing message:", data.MessageId);
    return true;
  } catch (error) {
    console.error("[SNS ERROR] publishing message:", error);
    return false;
  }
}
