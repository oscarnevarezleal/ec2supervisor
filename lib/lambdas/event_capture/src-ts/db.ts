import {Entity, Table} from 'dynamodb-toolbox'

// @ts-ignore
import DynamoDB from 'aws-sdk/clients/dynamodb'

const DocumentClient = new DynamoDB.DocumentClient({
    // Specify your client options as usual
    convertEmptyValue: false
})

export const UserDataTable = new Table({
    // Specify table name (used by DynamoDB)
    // @ts-ignore
    name: process.env.state_table,
    // Define partition and sort keys
    partitionKey: 'instance-id',
    sortKey: 'time',
    DocumentClient
})

export const InstanceStateEvent = new Entity({
    // Specify entity name
    name: 'InstanceStateEvent',

    // Define attributes
    attributes: {
        // ---
        ['instance-id']: {partitionKey: true}, // flag as partitionKey
        time: {
            sortKey: true
        },
        // x: {type: 'string', required: false},
        // createdAt: {type: 'string', default: () => new Date().toISOString()}, // specify attribute as required
    },

    // Assign it to our table
    table: UserDataTable

    // In Typescript, the "as const" statement is needed for type inference
    // @ts-ignore
} as const)