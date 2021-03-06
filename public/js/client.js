(function () {
    client = function (wsServerUrl) {
        this.CHUNK_SIZE = 500; //bytes
        this.clientId;
        this.peerConnections = {};
        this.dataChannels = {};
        this.initiateClient(wsServerUrl);
        this.registerEvents();
        this.chunks = {};// <id, arrybuffer>
        this.numOfChunksInFile;
        this.hasEntireFile = false;
    };

    client.prototype = {

        updateMetadata:function(files){
            this.numOfChunksInFile = files[0].numOfChunks;
        },

        chunkFile:function(base64file) {
            this.numOfChunksInFile = Math.ceil(base64file.length/this.CHUNK_SIZE)
            for (var i=0;i<this.numOfChunksInFile;i++) {
                var start = i*this.CHUNK_SIZE;
                this.chunks[i] = base64file.slice(start, start+this.CHUNK_SIZE);
            }
        },

        addFile:function(body) {
            debugger;
            var splitAns = body.split(',');
            var base64file = splitAns[1];
            this.chunkFile(base64file);
            this.hasEntireFile = true;
        },

        receiveChunk:function(chunkId,chunkData){
            this.chunks[chunkId] = chunkData;
            this.checkHasEntireFile();
        },

        requestChunks:function(dataChannel,chunkNum){
            this.sendCommand(dataChannel, proto64.need(this.clientId, 1, 1, chunkNum));
        },



        checkHasEntireFile:function(){
            if(Object.keys(this.chunks).length == this.numOfChunksInFile){
                //ToDo: anounce has file base64.decode the strings and open it
                console.log("I have the entire file");
                this.hasEntireFile = true;
                ws.sendDownloadCompleted();
                this.saveFileLocally();
            }
        },

        saveFileLocally:function(){
            var stringFile = '';
            for(var i=0;i<this.numOfChunksInFile;++i){
                stringFile += this.chunks[i];
            }
            var blob = new Blob([base64.decode(stringFile)]);
            saveLocally(blob);
        },

        initiateClient:function (wsServerUrl) {
            var thi$ = this;
            ws = new WsConnection(wsServerUrl);
            this.clientId; //either randomly create or get it from WsConnection

            this.initiatePeerConnectionCallbacks();
        },

        initiatePeerConnectionCallbacks:function(){
            replaceReturnCallback(print_);
            replaceDebugCallback(debug_);
            doNotAutoAddLocalStreamWhenCalled();
            hookupDataChannelCallbacks_();
        },

        ensureHasPeerConnection:function(peerId){
            if(!this.peerConnections[peerId]){
                this.peerConnections[peerId] = createPeerConnection(STUN_SERVER);
                this.peerConnections[peerId].remotePeerId = peerId;
                this.peerConnections[peerId].localPeerId = this.clientId;
            }

        },

        ensureHasDataChannel:function(peerConnection,peerId){
            if (peerConnection == null)
                throw failTest('Tried to create data channel, ' +
                    'but have no peer connection.');
            if (this.dataChannels[peerId] != null && this.dataChannels[peerId] != 'closed') {
                throw failTest('Creating DataChannel, but we already have one.');
            }
            this.dataChannels[peerId] = createDataChannel(peerConnection,peerId);
        },

        createDataChannel:function(remotePeerId){
            this.ensureHasPeerConnection(remotePeerId);
            this.ensureHasDataChannel(this.peerConnections[remotePeerId],remotePeerId);
        },

        sendCommand:function(dataChannel,message){
            var thi$=this;
            if(dataChannel.readyState == 'open'){
                setTimeout(function(message) {dataChannel.send(message)},150,message);
            }else{
                console.log('dataChannel wasnt ready, seting timeout');
                setTimeout(function(dataChannel,message){
                    thi$.sendCommand(dataChannel,message);
                },1000,dataChannel,message);
            }
        },

        registerEvents:function () {
            var thi$ = this;

            radio('receivedRoomMetadata').subscribe([function(files){
                this.updateMetadata(files);
            },this]);

            radio('commandArrived').subscribe([function(dataChannel, cmd){
                if (cmd.op == proto64.NEED_CHUNK) {
                    console.log("received NEED_CHUNK command " + cmd.chunkId);
                    if (cmd.chunkId in this.chunks) {
                    this.sendCommand(dataChannel, proto64.send(this.clientId,1,1,cmd.chunkId,this.chunks[cmd.chunkId]))
                    } else {
                        console.warn('I dont have this chunk' + cmd.chunkId);
                    }
                }else if(cmd.op == proto64.DATA_TAG){
                    console.log("received DATA_TAG command with chunk id " + cmd.chunkId);
                    this.receiveChunk(cmd.chunkId,cmd.data);
                    if(!this.hasEntireFile)
                        this.requestChunks(dataChannel,cmd.chunkId+1);
                }
            },thi$]);

            radio('connectionReady').subscribe([function(dataChannel) {
                if (0 in this.chunks) {
                    console.log('got chunk 0');
                } else {
                    console.log('requesting chunk 0');
                    this.requestChunks(dataChannel,0);
                }
            }, thi$]);

            radio('receivedMatch').subscribe([function (message) {
                for(var i=0;i<message.clientIds.length;++i){
                    thi$.createDataChannel(message.clientIds[i]);
                    setupCall(thi$.peerConnections[message.clientIds[i]]);
                }
            }, this]);

            radio('receivedOffer').subscribe([function (message) {
                thi$.ensureHasPeerConnection(message.originId);
                handleMessage(thi$.peerConnections[message.originId],message.sdp);
            }, this]);

            radio('socketConnected').subscribe([function(){
               thi$.clientId = ws.socket.socket.sessionid;
                console.log('got an id: ' + thi$.clientId);
            },this]);

            radio('onCreateDataChannelCallback').subscribe([function(event){
                if (this.dataChannels[event.currentTarget.remotePeerId] != null && this.dataChannels[event.currentTarget.remotePeerId].readyState != 'closed') {
                throw failTest('Received DataChannel, but we already have one.');
                }
                this.dataChannels[event.currentTarget.remotePeerId] = event.channel;
                debug('DataChannel with label ' + this.dataChannels[event.currentTarget.remotePeerId].label +
                    ' initiated by remote peer.');
                hookupDataChannelEvents(this.dataChannels[event.currentTarget.remotePeerId]);
                },this]);
        }
    };
})();