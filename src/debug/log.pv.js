module.exports = [ function () {

	var debugEnabled = false;
	var debugNamespaces = [];

	this.enableDebug = function () {
		debugEnabled = true;
	};

	this.enableDebugNamespace = function () {
		for ( let i = 0; i < arguments.length; i++ ) {
			debugNamespaces.push( arguments[ i ] );
		}
	};

	this.$get = () => {

		function debug() {
			if ( !debugEnabled ) return;
			var debugName = arguments[ 0 ];
			var slicedArgs = Array.prototype.slice.call( arguments, 1 );
			if ( debugName === 'err' ) {
				console.error.apply( console, slicedArgs );
			} else if ( debugName === 'info' ) {
				console.info.apply( console, slicedArgs );
			} else if ( debugNamespaces.indexOf( debugName ) !== -1 ) {
				console.log.apply( console, slicedArgs );
			}
		}

		return {
			debug
		};

	};

} ];
