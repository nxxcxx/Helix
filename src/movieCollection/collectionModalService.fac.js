module.exports = [ 'log', 'EVT', function ( log, EVT ) {

	var activeItem = null;

	function setActiveItem( item ) {
		activeItem = item;
	}

	function getActiveItem( item ) {
		return activeItem;
	}

	function open() {
		EVT.collectionModalOpen.emit();
	}

	function close() {
		EVT.collectionModalClose.emit();
	}

	return {
		setActiveItem,
		getActiveItem,
		open,
		close
	};

} ];
