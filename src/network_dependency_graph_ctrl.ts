import { MetricsPanelCtrl } from 'grafana/app/plugins/sdk';
import _, { find, map, isUndefined, remove, each, has } from 'lodash';
import { optionsTab } from './options_ctrl';
import './css/network-dependency-graph-panel.css';
import PreProcessor from './processing/pre_processor'

import GraphGenerator from './processing/graph_generator'

import { CanvasDrawer } from './canvas/graph_canvas';
import cytoscape, { NodeSingular, EdgeSingular, EventObject, EdgeCollection } from 'cytoscape';
import cola from 'cytoscape-cola';
import avsdf from 'cytoscape-avsdf';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';
import cyCanvas from 'cytoscape-canvas';

import layoutOptions from './layout_options';
import { DataMapping, IGraph, IGraphNode, IGraphEdge, CyData, PanelSettings, CurrentData, QueryResponse, TableContent, IGraphMetrics, ISelectionStatistics } from './types';

import dummyData from "./dummy_graph";
import humanFormat from 'human-format';

// Register cytoscape extensions
cyCanvas(cytoscape);
cytoscape.use(cola);
//cytoscape.use(avsdf);
//cytoscape.use(fcose);
//cytoscape.use(dagre);

export class NetworkDependencyGraphCtrl extends MetricsPanelCtrl {

  static templateUrl = 'partials/module.html';

  panelDefaults = {
    settings: <PanelSettings>{
      showDummyData: false,
      animate: true,
      sumTimings: true,
      showConnectionStats: true,
      filterEmptyConnections: true,
      serviceIcons: [
        {
          pattern: 'java',
          filename: 'java'
        },
        {
          pattern: 'spok|star trek',
          filename: 'star_trek'
        },
      ],
      externalIcons: [
        {
          name: 'web',
          filename: 'web'
        },
        {
          name: 'jms',
          filename: 'message'
        },
        {
          name: 'jdbc',
          filename: 'database'
        },
        {
          name: 'http',
          filename: 'http'
        }
      ],
      style: {
        healthyColor: 'rgb(87, 148, 242)',
        dangerColor: 'rgb(184, 36, 36)',
        unknownColor: 'rgb(123, 123, 138)'
      },
      showDebugInformation: false,
      showBaselines: false,
      dataMapping: {
        bpsRxColumn: "bps_rx (mean)",
        epsRxColumn: "eps_rx (mean)",
        bpsTxColumn: "bps_tx (mean)",
        epsTxColumn: "eps_tx (mean)",
      },
      drillDownLink: "",
    }
  };

  currentData: CurrentData | undefined;

  cy: cytoscape.Core;

  graphCanvas: CanvasDrawer;

  initResize: boolean = true;

  preProcessor: PreProcessor = new PreProcessor(this);

  graphGenerator: GraphGenerator = new GraphGenerator(this);

  graphContainer: any;

  validQueryTypes: boolean;

  showStatistics: boolean = false;

  selectionId: string;

  interfaces: TableContent[];

  resolvedDrillDownLink: string;

  currentType: string;

  selectionStatistics: ISelectionStatistics;

  /** @ngInject */
  constructor($scope, $injector) {
    super($scope, $injector);
    _.defaultsDeep(this.panel, this.panelDefaults);
    this.events.on('init-edit-mode', this.onInitEditMode.bind(this));
    this.events.on('component-did-mount', this.onMount.bind(this));
    this.events.on('refresh', this.onRefresh.bind(this));
    this.events.on('render', this.onRender.bind(this));
    this.events.on('data-received', this.onDataReceived.bind(this));
    this.events.on('data-snapshot-load', this.onDataReceived.bind(this));
  }

  link(scope, element, attrs, controller) {
    console.log("Linking container DOM element.");

    this.graphContainer = element.find('.canvas-container')[0];
  }

  onRefresh() {
    console.log("refresh");

    if (this.getSettings().showDummyData) {
      this.updateDummyData();
    } 
  }

  onInitEditMode() {
    this.addEditorTab('Options', optionsTab, 2);
  }

  onPanelTeardown() {
  }

  toggleAnimation() {
    this.panel.settings.animate = !this.panel.settings.animate;

    if (this.panel.settings.animate) {
      this.graphCanvas.startAnimation();
    } else {
      this.graphCanvas.stopAnimation();
    }
  }

  zoom(zoom) {
    const zoomStep = 0.25 * zoom;
    const zoomLevel = Math.max(0.1, this.cy.zoom() + zoomStep);
    this.cy.zoom(zoomLevel);
  }

  isDataAvailable() {
    const dataExist = !isUndefined(this.currentData) && this.currentData.graph.length > 0;
    return dataExist;
  }

  _updateOrRemove(dataArray: (NodeSingular | EdgeSingular)[], inputArray: CyData[]) {
    const elements: (NodeSingular | EdgeSingular)[] = [];
    for (let i = 0; i < dataArray.length; i++) {
      const element = dataArray[i];

      const cyNode = find(inputArray, { data: { id: element.id() } });

      if (cyNode) {
        element.data(cyNode.data);
        remove(inputArray, n => n.data.id === cyNode.data.id);
        elements.push(element);
      } else {
        element.remove();
      }
    }
    return elements;
  }

  _updateGraph(graph: IGraph) {
    const cyNodes = this._transformNodes(graph.nodes);
    const cyEdges = this._transformEdges(graph.edges);

    console.groupCollapsed("Updating graph");
    console.log("cytoscape nodes: ", JSON.parse(JSON.stringify(cyNodes)));
    console.log("cytoscape edges: ", JSON.parse(JSON.stringify(cyEdges)));
    console.groupEnd();

    const nodes = this.cy.nodes().toArray();
    const updatedNodes = <NodeSingular[]>this._updateOrRemove(nodes, cyNodes);

    // add new nodes
    (<any>this.cy).add(cyNodes);

    const edges = this.cy.edges().toArray();
    this._updateOrRemove(edges, cyEdges);

    // add new edges
    (<any>this.cy).add(cyEdges);

    if (this.initResize) {
      this.initResize = false;
      this.cy.resize();
      this.cy.reset();
      this.runLayout();
    } else {
      if (cyNodes.length > 0) {
        each(updatedNodes, node => {
          node.lock();
        });
        this.runLayout(true);
      }
    }
  }

  _transformEdges(edges: IGraphEdge[]): CyData[] {
    const cyEdges = map(edges, edge => {
      const cyEdge = {
        group: 'edges',
        data: {
          id: edge.me + ":" + edge.peer + ":" + edge.direction,
          source: edge.me,
          target: edge.peer,
          direction: edge.direction,
          metrics: {
            ...edge.metrics
          }
        }
      };

      return cyEdge;
    });

    return cyEdges;
  }

  _transformNodes(nodes: IGraphNode[]): CyData[] {
    const cyNodes = map(nodes, node => {
      const result: CyData = {
        group: 'nodes',
        data: {
          id: node.name,
          type: node.type,
          external_type: node.external_type,
          metrics: {
            ...node.metrics
          }
        }
      };
      return result;
    });

    return cyNodes;
  }

  _initCytoscape() {
    const that = this;

    console.log("Initialize cytoscape..");

    this.cy = cytoscape({
      container: this.graphContainer,
      style: <any>[
        {
          "selector": "node",
          "style": {
            "background-opacity": 0
          }
        },
        {
          "selector": "edge",
          "style": {
            "visibility": "hidden"
          }
        }
      ],
      wheelSensitivity: 0.125
    });

    // create canvas layer
    const layer = (<any>this.cy).cyCanvas({
      zIndex: 1
    });

    this.graphCanvas = new CanvasDrawer(this, this.cy, layer);
    this.graphCanvas.start();
    if (this.panel.settings.animate) {
      this.graphCanvas.startAnimation();
    }

    this.cy.reset();
    this.cy.resize();
    this.cy.center();

    this.cy.on('render', (event) => {
      // trigger also repainting of the graph canvas overlay
      that.graphCanvas.repaint(true);
    });

    this.cy.on('select', 'node', (event) => that.onSelectionChange(event));
    this.cy.on('unselect', 'node', (event) => that.onSelectionChange(event));
  }

  onSelectionChange(event: EventObject) {
    const selection = this.cy.$(':selected');

    if (selection.length === 1) {
      this.showStatistics = true;
      this.updateStatisticTable();
    } else {
      this.showStatistics = false;
    }
    this.$scope.$apply();
  }

  updateStatisticTable() {
    const selection = this.cy.$(':selected');

    if (selection.length === 1) {
      const currentNode: NodeSingular = selection[0];
      this.selectionId = currentNode.id();
      this.currentType = currentNode.data('type');
      const interfaces: TableContent[] = [];
      const edges: EdgeCollection = selection.connectedEdges();

      const metrics: IGraphMetrics = selection.nodes()[0].data('metrics');
      const bps = _.defaultTo(metrics.bps, -1);
      const eps = _.defaultTo(metrics.eps, -1);
      const pps = _.defaultTo(metrics.pps, -1);

      this.selectionStatistics = {};

      if (bps >= 0) {
        this.selectionStatistics.bps = humanFormat(bps, 0);
      }
      if (eps >= 0) {
        this.selectionStatistics.eps = humanFormat(eps, 1);
      }
      if (pps >= 0) {
        this.selectionStatistics.pps = humanFormat(pps, 1);
      }

      for (let i = 0; i < edges.length; i++) {

        const actualEdge: EdgeSingular = edges[i];
        const target: boolean = actualEdge.target().id() === currentNode.id();
        const edgeMetrics: IGraphMetrics = actualEdge.data('metrics');
        const direction: string = actualEdge.data('direction');
        const tc_name = edgeMetrics.if_name + ' (' + direction + ')';
        const sendingObject: TableContent = {
          if_name: tc_name,
          if_link: this.generateInterfaceDrillDownLink(currentNode.id(), edgeMetrics.if_name),
          pps: humanFormat(edgeMetrics.pps, 1),
          bps: humanFormat(edgeMetrics.bps, 1),
          eps: humanFormat(edgeMetrics.eps, 1),
          remote_host: target ? actualEdge.source().id() : actualEdge.target().id(),
          remote_intf: edgeMetrics.peer_if_name,
        };
        interfaces.push(sendingObject);
      }
      this.interfaces = interfaces;

      this.generateDrillDownLink();
    }
  }

  onMount() {
    if (this.getSettings().showDummyData) {
      this.updateDummyData();
    } else {
      this.render();
    }
  }

  onRender(payload) {
    console.log("render");

    if (!this.cy) {
      this._initCytoscape();
    }

    if (this.isDataAvailable()) {
      const graph: IGraph = this.graphGenerator.generateGraph((<CurrentData>this.currentData).graph);
      console.log(graph);
      console.log("RILEY");
      this._updateGraph(graph);
      this.updateStatisticTable();
    }
  }

  getError(): string | null {
    if (!this.validQueryTypes) {
      return "Invalid query types - only use queries which return table data.";
    }
    if (!this.isDataAvailable()) {
      return "No data to show - the query returned no data.";
    }
    return null;
  }

  runLayout(unlockNodes: boolean = false) {
    const that = this;

    const options = {
      ...layoutOptions,
      stop: function () {
        if (unlockNodes) {
          that.unlockNodes();
        }
      }
    };

    console.log("RILEY LAYOUT, options", options);
    this.cy.layout(options).run()
  }

  unlockNodes() {
    this.cy.nodes().forEach(node => {
      node.unlock();
    });
  }

  fit() {
    const selection = this.graphCanvas.selectionNeighborhood;
    if (selection && !selection.empty()) {
      this.cy.fit(selection, 30);
    } else {
      this.cy.fit();
    }
  }

  hasAggregationVariable() {
    return true;
  }

  hasOnlyTableQueries(inputData: QueryResponse[]) {
    var result: boolean = true;

    each(inputData, dataElement => {
      if (!has(dataElement, 'columns')) {
        result = false;
      }
    });

    return result;
  }

  onDataReceived(receivedData: QueryResponse[]) {
    // only if dummy data is not enabled
    if (!this.getSettings().showDummyData) {
      this.processQueryData(receivedData);
    }
  }

  updateDummyData() {
    if (this.getSettings().showDummyData) {
      this.processQueryData(dummyData);
    } else {
      this.currentData = undefined;
    }
  }

  processQueryData(data: QueryResponse[]) {
    this.validQueryTypes = this.hasOnlyTableQueries(data);

    if (this.hasAggregationVariable() && this.validQueryTypes) {
      const graphData = this.preProcessor.processData(data);

      console.groupCollapsed('Processed received data');
      console.log('raw data: ', data);
      console.log('graph data: ', graphData);
      console.groupEnd();

      this.currentData = graphData;
    } else {
      this.currentData = undefined;
    }
    this.render();
  }

  getTemplateVariable(name) {
    let variable: any = find(this.dashboard.templating.list, {
      name: name
    });
    return variable.current.value;
  }

  getAssetUrl(assetName: string) {
    var baseUrl = 'public/plugins/' + this.panel.type;
    return baseUrl + '/assets/' + assetName;
  }

  getTypeSymbol(type, resolveName = true) {
    if (!type) {
      return this.getAssetUrl('default.png');
    }

    if (!resolveName) {
      return this.getAssetUrl(type);
    }

    const { externalIcons } = this.getSettings();

    const icon = find(externalIcons, icon => icon.name.toLowerCase() === type.toLowerCase());

    if (icon !== undefined) {
      return this.getAssetUrl(icon.filename + '.png');
    } else {
      return this.getAssetUrl('default.png');
    }
  }

  getDataMapping(): DataMapping {
    return this.getSettings().dataMapping;
  }

  getSettings(): PanelSettings {
    return this.panel.settings;
  }

  generateDrillDownLink() {
    const { drillDownLink } = this.getSettings();
    const link = drillDownLink.replace('{device}', this.selectionId);
    this.resolvedDrillDownLink = this.templateSrv.replace(link);
  }

  generateInterfaceDrillDownLink(device, intf) {
    const { interfaceDrillDownLink } = this.getSettings();
    const dlink = interfaceDrillDownLink.replace('{device}', device);
    const ilink = dlink.replace('{intf}', intf);
    return this.templateSrv.replace(ilink);
  }

}
