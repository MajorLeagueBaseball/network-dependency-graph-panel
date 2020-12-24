import _, { groupBy, filter, map, sum, some, isUndefined, uniq, difference, flatMap, concat, mean, defaultTo, find, size } from 'lodash';
import { isPresent } from '../util/Utils';
import { NetworkDependencyGraphCtrl } from '../network_dependency_graph_ctrl';
import { GraphDataElement, IGraph, IGraphEdge, IGraphMetrics, IGraphNode, EGraphNodeType, GraphDataType } from '../types';

class GraphGenerator {

	controller: NetworkDependencyGraphCtrl;

	constructor(controller: NetworkDependencyGraphCtrl) {
		this.controller = controller;
	}

	_createNode(dataElements: GraphDataElement[]): IGraphNode | undefined {

		if (!dataElements || dataElements.length <= 0) {
			return undefined;
		}

		const sumMetrics = this.controller.getSettings().sumTimings;

		const nodeName = dataElements[0].me;
		const nodeType = EGraphNodeType.INTERNAL;

		const metrics: IGraphMetrics = {};

		const node: IGraphNode = {
			name: nodeName,
			type: nodeType,
			metrics
		};

		const aggregationFunction = sumMetrics ? sum : mean;

		metrics.bps = sum(map(dataElements, element => (element.data.bps_rx + element.data.bps_tx)));
		metrics.eps = sum(map(dataElements, element => (element.data.eps_rx + element.data.eps_tx)));

		return node;
	}

	_createMissingNodes(data: GraphDataElement[], nodes: IGraphNode[]): IGraphNode[] {
		const existingNodeNames = map(nodes, node => node.name);
		const expectedNodeNames = uniq(flatMap(data, dataElement => [dataElement.me, dataElement.peer])).filter(isPresent);
		const missingNodeNames = difference(expectedNodeNames, existingNodeNames);

		const missingNodes = map(missingNodeNames, name => {
			let nodeType: EGraphNodeType;
			let external_type: string | undefined;

			// derive node type
			let elementMe = find(data, { me: name });
			let elementPeer = find(data, { peer: name });
      nodeType = EGraphNodeType.INTERNAL;
			return <IGraphNode>{
				name,
				type: nodeType,
				external_type: 'FOO'
			};
		});

		return missingNodes;
	}

	_createNodes(data: GraphDataElement[]): IGraphNode[] {
		const filteredData = filter(data, dataElement => dataElement.me !== dataElement.peer);

		const targetGroups = groupBy(filteredData, 'me');

		const nodes = map(targetGroups, group => this._createNode(group)).filter(isPresent);

		// ensure that all nodes exist, even we have no data for them
		const missingNodes = this._createMissingNodes(filteredData, nodes);

		return concat(nodes, missingNodes);
	}

  // return an edge for each direction (inbound and outbound)
	_createEdge(dataElement: GraphDataElement): IGraphEdge[] | undefined {
		const { me, peer } = dataElement;

		if (me === undefined || peer === undefined) {
			console.error("me and peer are necessary to create an edge", dataElement);
			return undefined;
		}

    const edges = [];
    for (let i = 0; i < 2; i++) {
		  const metrics: IGraphMetrics = {};

      const direction = 'in';
		  const edge: IGraphEdge = {
			  me,
			  peer,
        direction,
			  metrics
		  };

      console.log("GraphDataElement", dataElement.data);

		  const { bps_rx, bps_tx, eps_rx, eps_tx, pps_rx, pps_tx, if_name, peer_if_name } = dataElement.data;

      metrics.if_name = if_name;
      metrics.peer_if_name = peer_if_name;

      if (i == 0) {
		    metrics.bps = bps_rx;
        metrics.eps = eps_rx;
        metrics.pps = pps_rx;
        edge.direction = 'in';
      } else {
		    metrics.bps = bps_tx;
        metrics.eps = eps_tx;
        metrics.pps = pps_tx;
        edge.direction = 'out';
      }

      edges.push(edge);
    }

		return edges;
	}

	_createEdges(data: GraphDataElement[]): IGraphEdge[] {

		const filteredData = _(data)
			.filter(e => !!e.me)
			.filter(e => e.me !== e.peer)
			.value();

    const edges: IGraphEdge[] = [];
    for (const element of filteredData) {
		  const es = this._createEdge(element);
      for (const e of es) {
        edges.push(e)
      }
    }
		return edges.filter(isPresent);
	}

	_filterData(graph: IGraph): IGraph {
		const { filterEmptyConnections: filterData } = this.controller.getSettings();

		if (filterData) {
			const filteredGraph: IGraph = {
				nodes: [],
				edges: []
			};

			// filter empty connections
			filteredGraph.edges = filter(graph.edges, edge => size(edge.metrics) > 0);

			filteredGraph.nodes = filter(graph.nodes, node => {
				const name = node.name;

				// don't filter connected elements
				if (some(graph.edges, { 'me': name }) || some(graph.edges, { 'peer': name })) {
					return true;
				}

				const metrics = node.metrics;
				if (!metrics) {
					return false; // no metrics
				}

				// only if rate, error rate or response time is available
				return defaultTo(metrics.rate, -1) >= 0
					|| defaultTo(metrics.error_rate, -1) >= 0
					|| defaultTo(metrics.response_time, -1) >= 0;
			});

			return filteredGraph;
		} else {
			return graph;
		}
	}

	generateGraph(graphData: GraphDataElement[]): IGraph {
		//const filteredData = this._filterData(graphData);

		const nodes = this._createNodes(graphData);
		const edges = this._createEdges(graphData);

		const graph: IGraph = {
			nodes,
			edges
		};

		const filteredGraph = this._filterData(graph);

		console.groupCollapsed('Graph generated');
		console.log('Input data:', graphData);
		console.log('Nodes:', nodes);
		console.log('Edges:', edges);
		console.log('Filtered graph', filteredGraph);
		console.groupEnd();

		return filteredGraph;
	}
}

export default GraphGenerator;
