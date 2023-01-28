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
import {InstanceStateEvent} from './db'

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
    public async handler(event: SQSEvent, context: Context, callback: APIGatewayProxyCallback): Promise<void> {

        // Process SQS Records
        for (const record of event.Records) {
            try {
                const body = JSON.parse(record.body)
                await InstanceStateEvent.put({
                    [`instance-id`]: body?.detail['instance-id'],
                    time: new Date().getTime()
                })
            } catch (e: any) {
                logger.error(e)
            }
        }
    }
}

export const myFunction = new Lambda();
export const handler = myFunction.handler;
