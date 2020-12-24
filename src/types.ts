export interface PanelSettings {
  animate: boolean;
  sumTimings: boolean;
  filterEmptyConnections: boolean;
  style: PanelStyleSettings;
  showDebugInformation: boolean;
  showConnectionStats: boolean;
  externalIcons: IconResource[];
  dataMapping: DataMapping;
  showDummyData: boolean;
  drillDownLink: string;
  showBaselines: boolean;
};

export interface DataMapping {
  bpsRxColumn: string;
  epsRxColumn: string;
  ppsRxColumn: string;
  bpsTxColumn: string;
  epsTxColumn: string;
  ppsTxColumn: string;
  ifNameColumn: string;
  remoteIfNameColumn: string;
};

export interface PanelStyleSettings {
  healthyColor: string;
  dangerColor: string;
  unknownColor: string;
}

export interface IconResource {
  name: string;
  filename: string;
}

export interface QueryResponseColumn {
  type?: string;
  text: string;
};

export interface QueryResponse {
  columns: QueryResponseColumn[];
  refId?: string;
  meta?: string;
  rows: any[];
};

export interface CyData {
  group: string;
  data: {
    id: string;
    source?: string;
    target?: string;
    metrics: IGraphMetrics;
    type?: string;
    external_type?: string;
  }
};

export interface CurrentData {
  graph: GraphDataElement[];
  raw: QueryResponse[];
  columnNames: string[];
}

export interface GraphDataElement {
  me?: string;
  peer: string;
  data: DataElement;
  type: GraphDataType;
};

export interface DataElement {
  bps_rx?: number;
  bps_tx?: number;
  eps_rx?: number;
  eps_tx?: number;
  pps_rx?: number;
  pps_tx?: number;
};

export enum GraphDataType {
  SELF = 'SELF',
  PEERED = 'PEERED',
  PEERLESS = 'PEERLESS'
};

export interface IGraph {
  nodes: IGraphNode[],
  edges: IGraphEdge[]
};

export interface IGraphNode {
  name: string;
  type: EGraphNodeType;
  metrics?: IGraphMetrics;
  external_type?: string;
};

export interface IGraphMetrics {
  bps?: number;
  eps?: number;
};

export enum EGraphNodeType {
  INTERNAL = 'INTERNAL',
  EXTERNAL = 'EXTERNAL'
};

export interface IGraphEdge {
  source: string;
  target: string;
  direction: string;
  metrics?: IGraphMetrics;
};

export interface Particle {
  velocity: number;
  startTime: number;
};

export interface Particles {
  normal: Particle[];
  danger: Particle[];
};

export interface CyCanvas {
  getCanvas: () => HTMLCanvasElement;
  clear: (CanvasRenderingContext2D) => void;
  resetTransform: (CanvasRenderingContext2D) => void;
  setTransform: (CanvasRenderingContext2D) => void;
};

export interface TableContent {
  name: string;
  responseTime: string;
  rate: string;
  error: string;
};

export interface ISelectionStatistics {
  bps?: number;
  eps?: number;
  pps?: number;
};

