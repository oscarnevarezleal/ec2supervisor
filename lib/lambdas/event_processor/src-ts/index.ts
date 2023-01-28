// @ts-ignore
import {
    APIGatewayEvent,
    APIGatewayProxyCallback,
    Context,
    DynamoDBStreamEvent,
    EventBridgeEvent,
    SQSEvent
} from 'aws-lambda';
// @ts-ignore
import {LambdaInterface} from "@aws-lambda-powertools/commons";
import {Logger} from "@aws-lambda-powertools/logger";
import {Metrics} from '@aws-lambda-powertools/metrics';
import {DescribeInstancesCommand, DescribeInstancesCommandOutput, EC2Client} from "@aws-sdk/client-ec2"; // ES Modules import
import {InstanceStateEvent} from './db'

const client = new EC2Client({region: process.env.AWS_REGION || 'us-east-1'});

const DEFAULT_DIMENSIONS = {'environment': process.env.STAGE};
const metrics = new Metrics({namespace: 'ec2_supervisor', serviceName: 'event_capture'});

/**
 *
 * @param event
 * @param context
 * @param callback
 */

const logger = new Logger();

class Lambda implements LambdaInterface {
    // @ts-ignore
    @logger.injectLambdaContext({logEvent: true})
    // @ts-ignore
    @metrics.logMetrics({captureColdStartMetric: true, defaultDimensions: DEFAULT_DIMENSIONS})
    public async handler(event: DynamoDBStreamEvent, context: Context, callback: APIGatewayProxyCallback): Promise<void> {

        // Process DynamoDb stream of events
        for (const record of event.Records) {

            if (record.eventName === 'REMOVE') {
                continue
            }

            const instance_id = record.dynamodb.NewImage['instance-id']['S']

            // check if exists
            const rows = await InstanceStateEvent.query(instance_id)

            console.log('rows', JSON.stringify(rows, null, 3))

            const exists: boolean = rows.Count > 0

            const command = new DescribeInstancesCommand({
                InstanceIds: [instance_id]
            });

            const instance_response: DescribeInstancesCommandOutput = await client.send(command);

            console.log('instance_response', JSON.stringify(instance_response, null, 3))

            const payload = {
                [`instance-id`]: instance_id,
                state: instance_response.Reservations[0]?.Instances[0]?.State.Name
                // state: instance['State']['Name'],
            }

            if (exists) {
                await InstanceStateEvent.update({
                    ...rows.Items[0],
                    ...payload
                })
            } else {
                await InstanceStateEvent.put({
                    ...payload,
                    time: new Date().getTime()
                })
            }
        }
    }
}

export const myFunction = new Lambda();
export const handler = myFunction.handler;
