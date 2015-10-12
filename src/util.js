function debounce( func, wait, immediate ) {
	var _this = this,
		_arguments = arguments;

	var timeout;
	return function () {

		var context = _this,
			args = _arguments;
		var later = function later() {

			timeout = null;
			if ( !immediate ) func.apply( context, args );
		};
		var callNow = immediate && !timeout;
		clearTimeout( timeout );
		timeout = setTimeout( later, wait );
		if ( callNow ) func.apply( context, args );
	};
}

module.exports = {
	debounce
};
