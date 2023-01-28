import * as lambda from "aws-cdk-lib/aws-lambda";

export interface HasStage {
    stage: string
}

export interface HasLayers {
    layers: lambda.LayerVersion[]
}